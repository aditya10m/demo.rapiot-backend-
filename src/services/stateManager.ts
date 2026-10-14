import { EventEmitter } from 'events';
import { DeviceState, DeviceConnectionStatus, TelemetryData, MQTTBrokerStatus } from '../types/index.js';
import { AppConfig } from '../config/index.js';
import { logger } from './logger.js';

export class DeviceStateManager extends EventEmitter {
  private devices: Map<string, DeviceState> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private currentMqttStatus: MQTTBrokerStatus = 'disconnected';

  constructor(private config: AppConfig) {
    super();
    // Initialize allowed devices
    for (const id of config.allowedDeviceIds) {
      this.devices.set(id, {
        deviceId: id,
        status: 'UNKNOWN',
        lastSeen: null,
        lastTelemetry: null,
        mqttStatus: 'disconnected',
        pendingOutputs: {}
      });
    }

    // Start interval to detect device staleness / timeouts
    this.startStalenessCheck();
  }

  private startStalenessCheck() {
    this.checkInterval = setInterval(() => {
      this.evaluateDeviceTimeouts();
    }, 2000);
  }

  public setMqttStatus(status: MQTTBrokerStatus) {
    this.currentMqttStatus = status;
    for (const [id, dev] of this.devices.entries()) {
      dev.mqttStatus = status;
      this.emit('device_updated', dev);
    }
  }

  public getMqttStatus(): MQTTBrokerStatus {
    return this.currentMqttStatus;
  }

  public updateTelemetry(data: TelemetryData) {
    const { deviceId } = data;
    let dev = this.devices.get(deviceId);
    if (!dev) {
      dev = {
        deviceId,
        status: 'ONLINE',
        lastSeen: data.receivedAt,
        lastTelemetry: data,
        mqttStatus: this.currentMqttStatus,
        pendingOutputs: {}
      };
      this.devices.set(deviceId, dev);
    } else {
      dev.lastSeen = data.receivedAt;
      dev.lastTelemetry = data;
      dev.status = 'ONLINE';

      // Check if any pending output state matches incoming telemetry
      if (dev.pendingOutputs.DO1 && data.DO1 !== null) {
        if (dev.pendingOutputs.DO1.state === data.DO1) {
          logger.info(`DO1 verified via telemetry: state is ${data.DO1}`);
          delete dev.pendingOutputs.DO1;
        }
      }
      if (dev.pendingOutputs.DO2 && data.DO2 !== null) {
        if (dev.pendingOutputs.DO2.state === data.DO2) {
          logger.info(`DO2 verified via telemetry: state is ${data.DO2}`);
          delete dev.pendingOutputs.DO2;
        }
      }
    }

    this.emit('telemetry', data);
    this.emit('device_updated', dev);
  }

  public updateDeviceStatus(deviceId: string, statusText: string) {
    const dev = this.getOrCreateDevice(deviceId);
    const upper = statusText.toUpperCase();
    if (upper === 'ONLINE' || upper === 'CONNECTED') {
      dev.status = 'ONLINE';
    } else if (upper === 'OFFLINE' || upper === 'DISCONNECTED') {
      dev.status = 'OFFLINE';
    } else {
      dev.status = 'UNKNOWN';
    }
    dev.lastSeen = new Date().toISOString();
    this.emit('device_updated', dev);
  }

  public setPendingOutput(deviceId: string, output: 'DO1' | 'DO2', state: boolean) {
    const dev = this.getOrCreateDevice(deviceId);
    dev.pendingOutputs[output] = {
      state,
      requestedAt: new Date().toISOString(),
      status: 'pending'
    };
    this.emit('device_updated', dev);
  }

  public handleCommandAck(deviceId: string, output: 'DO1' | 'DO2', success: boolean, confirmedState?: boolean) {
    const dev = this.devices.get(deviceId);
    if (!dev) return;

    if (dev.pendingOutputs[output]) {
      if (success) {
        dev.pendingOutputs[output]!.status = 'ack';
        if (dev.lastTelemetry && confirmedState !== undefined) {
          dev.lastTelemetry[output] = confirmedState;
        }
        // Auto clear after a short delay
        setTimeout(() => {
          if (dev.pendingOutputs[output]?.status === 'ack') {
            delete dev.pendingOutputs[output];
            this.emit('device_updated', dev);
          }
        }, 3000);
      } else {
        dev.pendingOutputs[output]!.status = 'failed';
        setTimeout(() => {
          delete dev.pendingOutputs[output];
          this.emit('device_updated', dev);
        }, 4000);
      }
      this.emit('device_updated', dev);
    }
  }

  public handleCommandTimeout(deviceId: string, output: 'DO1' | 'DO2') {
    const dev = this.devices.get(deviceId);
    if (dev && dev.pendingOutputs[output]) {
      dev.pendingOutputs[output]!.status = 'timeout';
      this.emit('device_updated', dev);
      setTimeout(() => {
        if (dev.pendingOutputs[output]?.status === 'timeout') {
          delete dev.pendingOutputs[output];
          this.emit('device_updated', dev);
        }
      }, 4000);
    }
  }

  private evaluateDeviceTimeouts() {
    const now = Date.now();
    const timeoutMs = this.config.deviceTimeoutSeconds * 1000;

    for (const [id, dev] of this.devices.entries()) {
      if (dev.lastSeen) {
        const lastSeenTime = new Date(dev.lastSeen).getTime();
        const diff = now - lastSeenTime;

        if (diff > timeoutMs && dev.status === 'ONLINE') {
          dev.status = 'STALE';
          logger.warn(`Device ${id} marked STALE (no telemetry for ${(diff / 1000).toFixed(1)}s)`);
          this.emit('device_updated', dev);
        }
      } else if (dev.status !== 'UNKNOWN') {
        dev.status = 'UNKNOWN';
        this.emit('device_updated', dev);
      }
    }
  }

  public getDeviceState(deviceId: string): DeviceState | null {
    return this.devices.get(deviceId) || null;
  }

  public getAllDevices(): DeviceState[] {
    return Array.from(this.devices.values());
  }

  public getOrCreateDevice(deviceId: string): DeviceState {
    let dev = this.devices.get(deviceId);
    if (!dev) {
      dev = {
        deviceId,
        status: 'UNKNOWN',
        lastSeen: null,
        lastTelemetry: null,
        mqttStatus: this.currentMqttStatus,
        pendingOutputs: {}
      };
      this.devices.set(deviceId, dev);
    }
    return dev;
  }

  public destroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}

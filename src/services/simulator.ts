import { AppConfig } from '../config/index.js';
import { DeviceStateManager } from './stateManager.js';
import { TelemetryData } from '../types/index.js';
import { logger } from './logger.js';

export class SimulatorService {
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private ai1Base = 12.4;
  private ai2Base = 4.8;
  private di1State = false;
  private di2State = false;
  private do1State = true;
  private do2State = false;
  private uptimeSeconds = 1420;

  constructor(
    private config: AppConfig,
    private stateManager: DeviceStateManager
  ) {}

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('Starting DEMO MODE simulation generator...');

    this.timer = setInterval(() => {
      this.generateTick();
    }, this.config.demoIntervalMs || 3000);

    // Initial immediate tick
    this.generateTick();
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    logger.info('Stopped DEMO MODE simulation generator.');
  }

  public isActive(): boolean {
    return this.isRunning;
  }

  public setSimulatedOutput(output: 'DO1' | 'DO2', state: boolean) {
    if (output === 'DO1') {
      this.do1State = state;
    } else {
      this.do2State = state;
    }
    // Simulate ACK to state manager
    this.stateManager.handleCommandAck(this.config.deviceId, output, true, state);
  }

  private generateTick() {
    this.uptimeSeconds += 3;
    // Add realistic analog drift
    const ai1Jitter = (Math.random() - 0.48) * 0.4;
    const ai2Jitter = (Math.random() - 0.5) * 0.2;
    this.ai1Base = Math.max(0, Math.min(24, this.ai1Base + ai1Jitter));
    this.ai2Base = Math.max(0, Math.min(10, this.ai2Base + ai2Jitter));

    // Occasionally toggle DI states for realistic demonstration
    if (Math.random() < 0.15) {
      this.di1State = !this.di1State;
    }
    if (Math.random() < 0.10) {
      this.di2State = !this.di2State;
    }

    const hours = Math.floor(this.uptimeSeconds / 3600);
    const minutes = Math.floor((this.uptimeSeconds % 3600) / 60);
    const seconds = this.uptimeSeconds % 60;
    const formattedUptime = `${hours}h ${minutes}m ${seconds}s`;

    const simulatedTelemetry: TelemetryData = {
      deviceId: this.config.deviceId,
      AI1: Math.round(this.ai1Base * 100) / 100,
      AI2: Math.round(this.ai2Base * 100) / 100,
      DI1: this.di1State,
      DI2: this.di2State,
      DO1: this.do1State,
      DO2: this.do2State,
      deviceTimestamp: new Date().toISOString(),
      networkUptime: formattedUptime,
      receivedAt: new Date().toISOString(),
      isSimulated: true,
      rawPayload: {
        _simulated: true,
        deviceId: this.config.deviceId,
        AI1: Math.round(this.ai1Base * 100) / 100,
        AI2: Math.round(this.ai2Base * 100) / 100,
        DI1: this.di1State,
        DI2: this.di2State,
        DO1: this.do1State,
        DO2: this.do2State,
        timestamp: new Date().toISOString(),
        networkUptime: formattedUptime
      }
    };

    this.stateManager.updateTelemetry(simulatedTelemetry);
  }
}

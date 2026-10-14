import mqtt, { MqttClient, IClientOptions } from 'mqtt';
import { AppConfig } from '../config/index.js';
import { parseTelemetryPayload } from '../parsers/telemetryParser.js';
import { ConfigurableCommandAdapter } from '../parsers/commandAdapter.js';
import { DeviceStateManager } from '../services/stateManager.js';
import { logger } from '../services/logger.js';

export class MQTTService {
  private client: MqttClient | null = null;
  private isConnecting: boolean = false;
  private commandAdapter: ConfigurableCommandAdapter;
  private reconnectCount: number = 0;

  constructor(
    private config: AppConfig,
    private stateManager: DeviceStateManager
  ) {
    this.commandAdapter = new ConfigurableCommandAdapter(config);
  }

  public connect(): void {
    if (this.client && this.client.connected) {
      logger.info('MQTT client already connected.');
      return;
    }

    const { host, port, protocol, username, password, clientId, rejectUnauthorized } = this.config.mqtt;

    // Build URL without credentials to avoid logging secrets
    const brokerUrl = `${protocol}://${host}:${port}`;
    logger.info(`Connecting to MQTT broker at ${brokerUrl} with Client ID: ${clientId}`);

    const options: IClientOptions = {
      clientId,
      clean: true,
      connectTimeout: 8000,
      reconnectPeriod: 5000,
      rejectUnauthorized,
      keepalive: 60,
    };

    if (username) {
      options.username = username;
    }
    if (password) {
      options.password = password;
    }

    this.isConnecting = true;
    this.stateManager.setMqttStatus('connecting');

    try {
      this.client = mqtt.connect(brokerUrl, options);
      this.setupEventHandlers();
    } catch (err: any) {
      logger.error('Failed to initialize MQTT connection:', err.message);
      this.stateManager.setMqttStatus('error');
    }
  }

  private setupEventHandlers(): void {
    if (!this.client) return;

    this.client.on('connect', (connack) => {
      this.isConnecting = false;
      this.reconnectCount = 0;
      logger.info('Successfully connected to MQTT broker.', { sessionPresent: connack.sessionPresent });
      this.stateManager.setMqttStatus('connected');

      // Subscribe to configured topics
      this.subscribeToTopics();
    });

    this.client.on('reconnect', () => {
      this.reconnectCount++;
      logger.warn(`MQTT reconnecting (attempt ${this.reconnectCount})...`);
      this.stateManager.setMqttStatus('reconnecting');
    });

    this.client.on('offline', () => {
      logger.warn('MQTT client went offline.');
      this.stateManager.setMqttStatus('disconnected');
    });

    this.client.on('close', () => {
      logger.warn('MQTT connection closed.');
      this.stateManager.setMqttStatus('disconnected');
    });

    this.client.on('error', (err: any) => {
      // Never log raw err object if it contains passwords
      logger.error(`MQTT connection error: ${err.message || 'Unknown MQTT error'}`);
      this.stateManager.setMqttStatus('error');
    });

    this.client.on('message', (topic: string, message: Buffer) => {
      this.handleIncomingMessage(topic, message);
    });
  }

  private subscribeToTopics(): void {
    if (!this.client || !this.client.connected) return;

    const topicsToSub = [
      this.config.mqtt.topics.telemetry,
      this.config.mqtt.topics.status,
      this.config.mqtt.topics.commandAck
    ].filter(Boolean);

    for (const topic of topicsToSub) {
      this.client.subscribe(topic, { qos: 1 }, (err, granted) => {
        if (err) {
          logger.error(`Failed to subscribe to topic: ${topic}`, err.message);
        } else {
          logger.info(`Subscribed to topic: ${topic}`, granted);
        }
      });
    }
  }

  private handleIncomingMessage(topic: string, message: Buffer): void {
    try {
      const msgStr = message.toString('utf-8');

      // Check if message matches telemetry topic pattern
      if (this.topicMatches(topic, this.config.mqtt.topics.telemetry)) {
        const parsed = parseTelemetryPayload(
          msgStr,
          this.config.payloadMapping,
          this.config.deviceId,
          topic
        );

        if (parsed.success && parsed.data) {
          this.stateManager.updateTelemetry(parsed.data);
        } else {
          logger.warn(`Telemetry parse error on topic [${topic}]: ${parsed.error}`);
        }
        return;
      }

      // Check if message matches status topic pattern
      if (this.topicMatches(topic, this.config.mqtt.topics.status)) {
        let statusStr = msgStr.trim();
        try {
          const json = JSON.parse(statusStr);
          statusStr = json.status || json.state || statusStr;
        } catch {
          // Plain text status
        }
        const extractedDeviceId = this.extractDeviceIdFromTopic(topic) || this.config.deviceId;
        this.stateManager.updateDeviceStatus(extractedDeviceId, statusStr);
        return;
      }

      // Check if message matches command ACK topic pattern
      if (this.topicMatches(topic, this.config.mqtt.topics.commandAck)) {
        const ack = this.commandAdapter.parseAck(msgStr);
        if (ack && ack.output) {
          const deviceId = this.extractDeviceIdFromTopic(topic) || this.config.deviceId;
          this.stateManager.handleCommandAck(
            deviceId,
            ack.output as 'DO1' | 'DO2',
            ack.success,
            ack.state
          );
        }
      }
    } catch (err: any) {
      logger.error(`Error processing message from topic ${topic}:`, err.message);
    }
  }

  public async publishCommand(
    deviceId: string,
    output: 'DO1' | 'DO2',
    state: boolean
  ): Promise<{ success: boolean; message: string }> {
    if (!this.commandAdapter.isConfigured()) {
      return {
        success: false,
        message: 'Device output control protocol is not configured. Guessing commands is prevented.'
      };
    }

    if (!this.client || !this.client.connected) {
      return {
        success: false,
        message: 'MQTT Broker is disconnected. Cannot publish command.'
      };
    }

    const commandData = this.commandAdapter.buildPayload(deviceId, output, state);
    if (!commandData) {
      return {
        success: false,
        message: 'Failed to build command payload for output'
      };
    }

    // Set pending state in state manager
    this.stateManager.setPendingOutput(deviceId, output, state);

    return new Promise((resolve) => {
      logger.info(`Publishing command to topic [${commandData.topic}] for ${deviceId}: ${commandData.payload}`);

      this.client!.publish(commandData.topic, commandData.payload, { qos: commandData.qos, retain: commandData.retain }, (err) => {
        if (err) {
          logger.error(`Publish error for ${output}: ${err.message}`);
          this.stateManager.handleCommandAck(deviceId, output, false);
          return resolve({
            success: false,
            message: `Publish failed: ${err.message}`
          });
        }

        // Start ACK timeout watcher
        const ackTimeoutMs = this.config.commandControl.ackTimeoutMs;
        setTimeout(() => {
          const currentState = this.stateManager.getDeviceState(deviceId);
          if (currentState?.pendingOutputs[output]?.status === 'pending') {
            logger.warn(`Command timeout waiting for device ACK on ${output}`);
            this.stateManager.handleCommandTimeout(deviceId, output);
          }
        }, ackTimeoutMs);

        resolve({
          success: true,
          message: `Command sent for ${output}=${state ? 'ON' : 'OFF'}. Waiting for device acknowledgment.`
        });
      });
    });
  }

  public getCommandAdapter(): ConfigurableCommandAdapter {
    return this.commandAdapter;
  }

  private topicMatches(topic: string, pattern: string): boolean {
    if (topic === pattern) return true;
    const regex = new RegExp('^' + pattern.replace(/\+/g, '[^/]+').replace(/#/g, '.+') + '$');
    return regex.test(topic);
  }

  private extractDeviceIdFromTopic(topic: string): string | null {
    const parts = topic.split('/');
    if (parts.length >= 2) {
      return parts[1];
    }
    return null;
  }

  public disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.client) {
        return resolve();
      }
      this.client.end(false, {}, () => {
        logger.info('MQTT client disconnected gracefully.');
        this.stateManager.setMqttStatus('disconnected');
        resolve();
      });
    });
  }
}

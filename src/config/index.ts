import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env
dotenv.config();

export interface AppConfig {
  port: number;
  nodeEnv: string;
  corsOrigin: string;
  apiSecretToken: string;
  mqtt: {
    host: string;
    port: number;
    protocol: 'mqtt' | 'mqtts' | 'tcp' | 'ssl' | 'ws' | 'wss';
    username?: string;
    password?: string;
    clientId: string;
    rejectUnauthorized: boolean;
    topics: {
      telemetry: string;
      status: string;
      command: string;
      commandAck: string;
    };
  };
  deviceId: string;
  allowedDeviceIds: string[];
  deviceTimeoutSeconds: number;
  demoMode: boolean;
  demoIntervalMs: number;
  payloadMapping: {
    deviceId: string;
    AI1: string;
    AI2: string;
    DI1: string;
    DI2: string;
    DO1: string;
    DO2: string;
    timestamp: string;
    uptime: string;
  };
  commandControl: {
    enabled: boolean;
    ackTimeoutMs: number;
    payloads: {
      DO1_ON: any;
      DO1_OFF: any;
      DO2_ON: any;
      DO2_OFF: any;
    };
  };
}

function parseJsonOrString(val: string | undefined, fallback: any): any {
  if (!val) return fallback;
  try {
    return JSON.parse(val);
  } catch {
    return val;
  }
}

function getArray(envVar: string | undefined, defaultArr: string[]): string[] {
  if (!envVar) return defaultArr;
  return envVar.split(',').map(s => s.trim()).filter(Boolean);
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.FRONTEND_ORIGIN || process.env.CORS_ORIGIN || 'http://localhost:5173',
  apiSecretToken: process.env.API_SECRET_TOKEN || 'rapiot_secure_super_secret_token_change_in_production',
  mqtt: {
    host: process.env.MQTT_HOST || '127.0.0.1',
    port: parseInt(process.env.MQTT_PORT || '1883', 10),
    protocol: (process.env.MQTT_PROTOCOL as any) || 'mqtt',
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    clientId: process.env.MQTT_CLIENT_ID || `rapiot_srv_${Math.random().toString(16).substring(2, 10)}`,
    rejectUnauthorized: process.env.MQTT_REJECT_UNAUTHORIZED !== 'false',
    topics: {
      telemetry: process.env.MQTT_TOPIC_TELEMETRY || 'rapiot/+/telemetry',
      status: process.env.MQTT_TOPIC_STATUS || 'rapiot/+/status',
      command: process.env.MQTT_TOPIC_COMMAND || 'rapiot/+/command',
      commandAck: process.env.MQTT_TOPIC_COMMAND_ACK || 'rapiot/+/command/ack',
    },
  },
  deviceId: process.env.DEVICE_ID || 'RAPIOT_1',
  allowedDeviceIds: getArray(process.env.ALLOWED_DEVICE_IDS, ['RAPIOT_1', 'RAPIOT_2']),
  deviceTimeoutSeconds: parseInt(process.env.DEVICE_TIMEOUT_SECONDS || '15', 10),
  demoMode: process.env.DEMO_MODE === 'true',
  demoIntervalMs: parseInt(process.env.DEMO_INTERVAL_MS || '3000', 10),
  payloadMapping: {
    deviceId: process.env.PAYLOAD_MAP_DEVICE_ID || 'deviceId',
    AI1: process.env.PAYLOAD_MAP_AI1 || 'AI1',
    AI2: process.env.PAYLOAD_MAP_AI2 || 'AI2',
    DI1: process.env.PAYLOAD_MAP_DI1 || 'DI1',
    DI2: process.env.PAYLOAD_MAP_DI2 || 'DI2',
    DO1: process.env.PAYLOAD_MAP_DO1 || 'DO1',
    DO2: process.env.PAYLOAD_MAP_DO2 || 'DO2',
    timestamp: process.env.PAYLOAD_MAP_TIMESTAMP || 'timestamp',
    uptime: process.env.PAYLOAD_MAP_UPTIME || 'networkUptime',
  },
  commandControl: {
    enabled: process.env.COMMAND_CONTROL_ENABLED === 'true',
    ackTimeoutMs: parseInt(process.env.COMMAND_ACK_TIMEOUT_MS || '5000', 10),
    payloads: {
      DO1_ON: parseJsonOrString(process.env.DO1_ON_PAYLOAD, { output: 1, state: 1 }),
      DO1_OFF: parseJsonOrString(process.env.DO1_OFF_PAYLOAD, { output: 1, state: 0 }),
      DO2_ON: parseJsonOrString(process.env.DO2_ON_PAYLOAD, { output: 2, state: 1 }),
      DO2_OFF: parseJsonOrString(process.env.DO2_OFF_PAYLOAD, { output: 2, state: 0 }),
    },
  },
};

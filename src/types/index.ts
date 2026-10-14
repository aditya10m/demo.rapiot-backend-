export type DeviceConnectionStatus = 'ONLINE' | 'OFFLINE' | 'CONNECTING' | 'STALE' | 'UNKNOWN';

export type MQTTBrokerStatus = 'connected' | 'disconnected' | 'connecting' | 'reconnecting' | 'error';

export interface TelemetryData {
  deviceId: string;
  AI1: number | null;
  AI2: number | null;
  DI1: boolean | null;
  DI2: boolean | null;
  DO1: boolean | null;
  DO2: boolean | null;
  deviceTimestamp: string | null;
  networkUptime: string | number | null;
  receivedAt: string;
  rawPayload?: any;
  isSimulated?: boolean;
}

export interface DeviceState {
  deviceId: string;
  status: DeviceConnectionStatus;
  lastSeen: string | null;
  lastTelemetry: TelemetryData | null;
  mqttStatus: MQTTBrokerStatus;
  pendingOutputs: {
    DO1?: { state: boolean; requestedAt: string; status: 'pending' | 'ack' | 'failed' | 'timeout' };
    DO2?: { state: boolean; requestedAt: string; status: 'pending' | 'ack' | 'failed' | 'timeout' };
  };
}

export interface OutputCommandRequest {
  output: 'DO1' | 'DO2';
  state: boolean;
}

export interface CommandAckPayload {
  deviceId: string;
  output: number | string;
  state: number | boolean | string;
  success: boolean;
  message?: string;
  timestamp?: string;
}

export interface TopicMapping {
  telemetry: string;
  status: string;
  command: string;
  commandAck: string;
}

export interface PayloadFieldMapping {
  deviceId: string;
  AI1: string;
  AI2: string;
  DI1: string;
  DI2: string;
  DO1: string;
  DO2: string;
  timestamp: string;
  uptime: string;
}

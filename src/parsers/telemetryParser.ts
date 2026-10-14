import { TelemetryData } from '../types/index.js';
import { logger } from '../services/logger.js';

export interface TelemetryMappingRules {
  deviceId?: string;
  AI1?: string;
  AI2?: string;
  DI1?: string;
  DI2?: string;
  DO1?: string;
  DO2?: string;
  timestamp?: string;
  uptime?: string;
}

/**
 * Extracts a value from an object using dot notation (e.g., 'inputs.analog[0]' or 'data.AI1')
 */
export function getNestedValue(obj: any, path: string): any {
  if (!obj || typeof obj !== 'object' || !path) return undefined;

  // If top-level key exists directly, return it
  if (Object.prototype.hasOwnProperty.call(obj, path)) {
    return obj[path];
  }

  // Support dot/bracket notation: "analog.ai1" or "telemetry.inputs[0]"
  const parts = path.replace(/\[(\w+)\]/g, '.$1').split('.');
  let current: any = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }

  return current;
}

/**
 * Normalizes boolean values according to configurable representations:
 * true/false, 1/0, "ON"/"OFF", "ACTIVE"/"INACTIVE", "HIGH"/"LOW", "CLOSED"/"OPEN", "ENABLED"/"DISABLED".
 * Does NOT coerce undefined, null, or unknown values to false.
 */
export function normalizeBoolean(value: any): boolean | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toUpperCase();
    if (['TRUE', '1', 'ON', 'ACTIVE', 'HIGH', 'CLOSED', 'ENABLED', 'SET'].includes(trimmed)) {
      return true;
    }
    if (['FALSE', '0', 'OFF', 'INACTIVE', 'LOW', 'OPEN', 'DISABLED', 'CLEAR'].includes(trimmed)) {
      return false;
    }
    return null;
  }
  return null;
}

/**
 * Normalizes numeric analog input values.
 * Does NOT coerce undefined or NaN to 0. Returns null if invalid or missing.
 */
export function normalizeNumber(value: any): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value.trim());
    return Number.isFinite(parsed) ? Math.round(parsed * 1000) / 1000 : null;
  }
  return null;
}

/**
 * Main telemetry parser:
 * - Parses raw string or Buffer into JSON
 * - Extracts mapped fields using configured paths
 * - Validates and normalizes without assuming false or 0 for missing fields
 * - Preserves rawPayload for diagnostics
 */
export function parseTelemetryPayload(
  payloadBufferOrString: Buffer | string | any,
  mapping: TelemetryMappingRules,
  defaultDeviceId: string = 'RAPIOT_1',
  topic?: string
): { success: boolean; data?: TelemetryData; error?: string } {
  let rawJson: any;

  if (typeof payloadBufferOrString === 'string' || Buffer.isBuffer(payloadBufferOrString)) {
    const str = payloadBufferOrString.toString('utf-8').trim();
    if (!str) {
      return { success: false, error: 'Empty payload received' };
    }
    try {
      rawJson = JSON.parse(str);
    } catch (err: any) {
      return { 
        success: false, 
        error: `Invalid JSON payload format: ${err?.message || 'SyntaxError'}` 
      };
    }
  } else if (typeof payloadBufferOrString === 'object' && payloadBufferOrString !== null) {
    rawJson = payloadBufferOrString;
  } else {
    return { success: false, error: 'Unsupported payload type received' };
  }

  // Device ID extraction: check mapped field, fallback to common aliases or topic
  let deviceId = getNestedValue(rawJson, mapping.deviceId || 'deviceId');
  if (!deviceId) {
    deviceId = rawJson.device_id || rawJson.id || rawJson.devId || rawJson.Device;
  }

  // If topic is provided like 'rapiot/RAPIOT_1/telemetry', extract device id from topic if missing in payload
  if (!deviceId && topic) {
    const parts = topic.split('/');
    if (parts.length >= 2 && parts[0] === 'rapiot') {
      deviceId = parts[1];
    }
  }

  if (!deviceId) {
    deviceId = defaultDeviceId;
  }

  // Extract Analog Inputs
  const rawAI1 = getNestedValue(rawJson, mapping.AI1 || 'AI1');
  const rawAI2 = getNestedValue(rawJson, mapping.AI2 || 'AI2');
  const AI1 = normalizeNumber(rawAI1 !== undefined ? rawAI1 : (rawJson.ai1 ?? rawJson.ai_1));
  const AI2 = normalizeNumber(rawAI2 !== undefined ? rawAI2 : (rawJson.ai2 ?? rawJson.ai_2));

  // Extract Digital Inputs
  const rawDI1 = getNestedValue(rawJson, mapping.DI1 || 'DI1');
  const rawDI2 = getNestedValue(rawJson, mapping.DI2 || 'DI2');
  const DI1 = normalizeBoolean(rawDI1 !== undefined ? rawDI1 : (rawJson.di1 ?? rawJson.di_1));
  const DI2 = normalizeBoolean(rawDI2 !== undefined ? rawDI2 : (rawJson.di2 ?? rawJson.di_2));

  // Extract Digital Outputs
  const rawDO1 = getNestedValue(rawJson, mapping.DO1 || 'DO1');
  const rawDO2 = getNestedValue(rawJson, mapping.DO2 || 'DO2');
  const DO1 = normalizeBoolean(rawDO1 !== undefined ? rawDO1 : (rawJson.do1 ?? rawJson.do_1));
  const DO2 = normalizeBoolean(rawDO2 !== undefined ? rawDO2 : (rawJson.do2 ?? rawJson.do_2));

  // Extract Timestamp & Uptime
  const rawTimestamp = getNestedValue(rawJson, mapping.timestamp || 'timestamp') 
    ?? rawJson.time 
    ?? rawJson.ts 
    ?? rawJson.deviceTime;
  
  const rawUptime = getNestedValue(rawJson, mapping.uptime || 'networkUptime') 
    ?? rawJson.uptime 
    ?? rawJson.network_uptime 
    ?? rawJson.upTime;

  const data: TelemetryData = {
    deviceId: String(deviceId),
    AI1,
    AI2,
    DI1,
    DI2,
    DO1,
    DO2,
    deviceTimestamp: rawTimestamp ? String(rawTimestamp) : null,
    networkUptime: rawUptime !== undefined && rawUptime !== null ? rawUptime : null,
    receivedAt: new Date().toISOString(),
    rawPayload: rawJson,
    isSimulated: Boolean(rawJson._simulated)
  };

  return { success: true, data };
}

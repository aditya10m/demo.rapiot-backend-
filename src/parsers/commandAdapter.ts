import { AppConfig } from '../config/index.js';
import { logger } from '../services/logger.js';

export interface CommandPayloadResult {
  topic: string;
  payload: string;
  qos: 0 | 1 | 2;
  retain: boolean;
}

export interface ICommandAdapter {
  isConfigured(): boolean;
  buildTopic(deviceId: string): string;
  buildPayload(deviceId: string, output: 'DO1' | 'DO2', state: boolean): CommandPayloadResult | null;
  parseAck(payloadString: string): { success: boolean; output?: string; state?: boolean; error?: string } | null;
}

/**
 * Standard RAPIOT Command Adapter implementation.
 * Adapts commands according to configurable payload templates or custom device specs.
 */
export class ConfigurableCommandAdapter implements ICommandAdapter {
  constructor(private config: AppConfig) {}

  public isConfigured(): boolean {
    return this.config.commandControl.enabled === true;
  }

  public buildTopic(deviceId: string): string {
    const template = this.config.mqtt.topics.command;
    // Replace wildcard '+' or specific placeholder '{deviceId}'
    if (template.includes('+')) {
      return template.replace('+', deviceId);
    }
    if (template.includes('{deviceId}')) {
      return template.replace('{deviceId}', deviceId);
    }
    return template;
  }

  public buildPayload(deviceId: string, output: 'DO1' | 'DO2', state: boolean): CommandPayloadResult | null {
    if (!this.isConfigured()) {
      logger.warn(`Attempted to build payload for ${output} but command control is disabled/not configured.`);
      return null;
    }

    const outputNum = output === 'DO1' ? 1 : 2;
    const stateNum = state ? 1 : 0;

    let payloadObj: any;
    if (output === 'DO1') {
      payloadObj = state ? this.config.commandControl.payloads.DO1_ON : this.config.commandControl.payloads.DO1_OFF;
    } else {
      payloadObj = state ? this.config.commandControl.payloads.DO2_ON : this.config.commandControl.payloads.DO2_OFF;
    }

    // If template is string with placeholders
    let payloadStr = '';
    if (typeof payloadObj === 'string') {
      payloadStr = payloadObj
        .replace('{deviceId}', deviceId)
        .replace('{output}', String(outputNum))
        .replace('{state}', String(stateNum));
    } else if (typeof payloadObj === 'object' && payloadObj !== null) {
      // Merge deviceId if needed
      const merged = { ...payloadObj, deviceId };
      payloadStr = JSON.stringify(merged);
    } else {
      payloadStr = JSON.stringify({ deviceId, output: outputNum, state: stateNum });
    }

    return {
      topic: this.buildTopic(deviceId),
      payload: payloadStr,
      qos: 1,
      retain: false
    };
  }

  public parseAck(payloadString: string): { success: boolean; output?: string; state?: boolean; error?: string } | null {
    try {
      const data = JSON.parse(payloadString);
      const out = data.output === 1 || data.output === 'DO1' ? 'DO1' : (data.output === 2 || data.output === 'DO2' ? 'DO2' : undefined);
      const state = data.state === 1 || data.state === true || data.state === 'ON';
      const success = data.success !== undefined ? Boolean(data.success) : (data.status === 'OK' || data.status === 'SUCCESS');

      return {
        success,
        output: out,
        state,
        error: data.error || data.message
      };
    } catch {
      return null;
    }
  }
}

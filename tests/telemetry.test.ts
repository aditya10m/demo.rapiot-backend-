import { describe, it } from 'node:test';
import assert from 'node:assert';
import { 
  parseTelemetryPayload, 
  normalizeBoolean, 
  normalizeNumber,
  getNestedValue
} from '../src/parsers/telemetryParser.js';
import { ConfigurableCommandAdapter } from '../src/parsers/commandAdapter.js';
import { config } from '../src/config/index.js';

describe('Telemetry Parser Unit Tests', () => {
  const defaultMapping = {
    deviceIdField: 'deviceId',
    AI1Field: 'AI1',
    AI2Field: 'AI2',
    DI1Field: 'DI1',
    DI2Field: 'DI2',
    DO1Field: 'DO1',
    DO2Field: 'DO2',
    timestampField: 'timestamp',
    uptimeField: 'networkUptime'
  };

  it('should parse standard sample JSON payload correctly', () => {
    const rawJson = JSON.stringify({
      deviceId: 'RAPIOT_1',
      AI1: 14.52,
      AI2: 3.14,
      DI1: true,
      DI2: false,
      DO1: true,
      DO2: false,
      timestamp: '2026-10-14T11:00:00Z',
      networkUptime: '24h 12m'
    });

    const res = parseTelemetryPayload(rawJson, defaultMapping, 'RAPIOT_1');
    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.strictEqual(res.data.deviceId, 'RAPIOT_1');
    assert.strictEqual(res.data.AI1, 14.52);
    assert.strictEqual(res.data.AI2, 3.14);
    assert.strictEqual(res.data.DI1, true);
    assert.strictEqual(res.data.DI2, false);
    assert.strictEqual(res.data.DO1, true);
    assert.strictEqual(res.data.DO2, false);
    assert.strictEqual(res.data.networkUptime, '24h 12m');
  });

  it('should not coerce missing fields to 0 or false', () => {
    const payloadWithMissing = JSON.stringify({
      deviceId: 'RAPIOT_1'
      // All AI, DI, DO are missing
    });

    const res = parseTelemetryPayload(payloadWithMissing, defaultMapping, 'RAPIOT_1');
    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.strictEqual(res.data.AI1, null);
    assert.strictEqual(res.data.AI2, null);
    assert.strictEqual(res.data.DI1, null);
    assert.strictEqual(res.data.DI2, null);
    assert.strictEqual(res.data.DO1, null);
    assert.strictEqual(res.data.DO2, null);
  });

  it('should handle alternative boolean representations (1/0, "ON"/"OFF", "ACTIVE"/"INACTIVE")', () => {
    assert.strictEqual(normalizeBoolean(1), true);
    assert.strictEqual(normalizeBoolean(0), false);
    assert.strictEqual(normalizeBoolean('ON'), true);
    assert.strictEqual(normalizeBoolean('OFF'), false);
    assert.strictEqual(normalizeBoolean('ACTIVE'), true);
    assert.strictEqual(normalizeBoolean('INACTIVE'), false);
    assert.strictEqual(normalizeBoolean('HIGH'), true);
    assert.strictEqual(normalizeBoolean('LOW'), false);
    assert.strictEqual(normalizeBoolean('invalid'), null);
    assert.strictEqual(normalizeBoolean(null), null);
    assert.strictEqual(normalizeBoolean(undefined), null);
  });

  it('should handle numeric normalization and strings gracefully', () => {
    assert.strictEqual(normalizeNumber(24.5678), 24.568);
    assert.strictEqual(normalizeNumber('12.3'), 12.3);
    assert.strictEqual(normalizeNumber('not-a-number'), null);
    assert.strictEqual(normalizeNumber(null), null);
  });

  it('should fail gracefully on invalid JSON', () => {
    const res = parseTelemetryPayload('{ bad json: ', defaultMapping, 'RAPIOT_1');
    assert.strictEqual(res.success, false);
    assert.ok(res.error?.includes('Invalid JSON'));
  });

  it('should extract nested paths correctly', () => {
    const nested = {
      sensor: {
        analog: [10.5, 20.2],
        digital: { in1: 1, in2: 0 }
      }
    };
    assert.strictEqual(getNestedValue(nested, 'sensor.analog[0]'), 10.5);
    assert.strictEqual(getNestedValue(nested, 'sensor.digital.in1'), 1);
    assert.strictEqual(getNestedValue(nested, 'sensor.digital.missing'), undefined);
  });
});

describe('Command Adapter Unit Tests', () => {
  it('should build command topic and payload correctly when configured', () => {
    const testConfig = {
      ...config,
      commandControl: {
        ...config.commandControl,
        enabled: true,
        payloads: {
          DO1_ON: { output: 1, state: 1 },
          DO1_OFF: { output: 1, state: 0 },
          DO2_ON: { output: 2, state: 1 },
          DO2_OFF: { output: 2, state: 0 }
        }
      }
    };
    const adapter = new ConfigurableCommandAdapter(testConfig);
    const cmd = adapter.buildPayload('RAPIOT_1', 'DO1', true);
    assert.ok(cmd);
    assert.strictEqual(cmd.topic, 'rapiot/RAPIOT_1/command');
    const parsedPayload = JSON.parse(cmd.payload);
    assert.strictEqual(parsedPayload.output, 1);
    assert.strictEqual(parsedPayload.state, 1);
  });

  it('should reject building payload and prevent guessing when command control is unconfigured', () => {
    const disabledConfig = {
      ...config,
      commandControl: {
        ...config.commandControl,
        enabled: false
      }
    };
    const adapter = new ConfigurableCommandAdapter(disabledConfig);
    const cmd = adapter.buildPayload('RAPIOT_1', 'DO1', true);
    assert.strictEqual(cmd, null);
  });

  it('should parse ACK payload correctly', () => {
    const adapter = new ConfigurableCommandAdapter(config);
    const ack = adapter.parseAck(JSON.stringify({
      deviceId: 'RAPIOT_1',
      output: 1,
      state: 1,
      success: true
    }));
    assert.ok(ack);
    assert.strictEqual(ack.success, true);
    assert.strictEqual(ack.output, 'DO1');
    assert.strictEqual(ack.state, true);
  });
});

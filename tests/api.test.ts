import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import express from 'express';
import { createApiRouter } from '../src/routes/api.js';
import { DeviceStateManager } from '../src/services/stateManager.js';
import { MQTTService } from '../src/mqtt/mqttClient.js';
import { SimulatorService } from '../src/services/simulator.js';
import { config } from '../src/config/index.js';

describe('Security and Output Control API Tests', () => {
  let server: http.Server;
  let port: number;

  before(async () => {
    const app = express();
    app.use(express.json());

    const stateManager = new DeviceStateManager(config);
    const mqttService = new MQTTService(config, stateManager);
    const simulator = new SimulatorService(config, stateManager);

    app.use('/api', createApiRouter(config, stateManager, mqttService, simulator));

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          port = addr.port;
        }
        resolve();
      });
    });
  });

  after(() => {
    server.close();
  });

  it('GET /api/health should return 200 with service status', async () => {
    const res = await fetch(`http://localhost:${port}/api/health`);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.status, 'healthy');
  });

  it('POST /api/devices/:deviceId/outputs/:outputId should reject unauthorized requests (401)', async () => {
    const res = await fetch(`http://localhost:${port}/api/devices/RAPIOT_1/outputs/DO1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: true })
    });
    assert.strictEqual(res.status, 401);
    const json = await res.json();
    assert.strictEqual(json.code, 'AUTH_REQUIRED');
  });

  it('POST output with invalid outputId (e.g., DI1) should be rejected (400) to protect read-only inputs', async () => {
    const res = await fetch(`http://localhost:${port}/api/devices/RAPIOT_1/outputs/DI1`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiSecretToken}`
      },
      body: JSON.stringify({ state: true })
    });
    assert.strictEqual(res.status, 400);
    const json = await res.json();
    assert.strictEqual(json.code, 'INVALID_OUTPUT_ID');
  });

  it('POST output with disallowed deviceId should be rejected (400)', async () => {
    const res = await fetch(`http://localhost:${port}/api/devices/UNAUTHORIZED_DEVICE/outputs/DO1`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiSecretToken}`
      },
      body: JSON.stringify({ state: true })
    });
    assert.strictEqual(res.status, 400);
    const json = await res.json();
    assert.strictEqual(json.code, 'INVALID_DEVICE_ID');
  });

  it('POST output with valid credentials and DO1 should queue command safely', async () => {
    const res = await fetch(`http://localhost:${port}/api/devices/RAPIOT_1/outputs/DO1`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiSecretToken}`
      },
      body: JSON.stringify({ state: true })
    });
    // Can be 200 (demo/queued) or 503/500 if real broker disconnected & demo disabled
    assert.ok(res.status === 200 || res.status === 503 || res.status === 500);
    const json = await res.json();
    if (res.status === 200) {
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.output, 'DO1');
    }
  });
});

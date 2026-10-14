import { Router, Request, Response } from 'express';
import { AppConfig } from '../config/index.js';
import { DeviceStateManager } from '../services/stateManager.js';
import { MQTTService } from '../mqtt/mqttClient.js';
import { SimulatorService } from '../services/simulator.js';
import { requireAuth, validateDeviceAndOutput } from '../middleware/auth.js';
import { logger } from '../services/logger.js';

export function createApiRouter(
  config: AppConfig,
  stateManager: DeviceStateManager,
  mqttService: MQTTService,
  simulator: SimulatorService
): Router {
  const router = Router();

  /**
   * GET /api/health
   */
  router.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      service: 'rapiot-backend',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      demoMode: simulator.isActive(),
      commandControlEnabled: config.commandControl.enabled
    });
  });

  /**
   * GET /api/mqtt/status
   */
  router.get('/mqtt/status', (req: Request, res: Response) => {
    res.json({
      brokerStatus: stateManager.getMqttStatus(),
      brokerHost: config.mqtt.host,
      brokerPort: config.mqtt.port,
      clientId: config.mqtt.clientId,
      subscribedTopics: {
        telemetry: config.mqtt.topics.telemetry,
        status: config.mqtt.topics.status,
        commandAck: config.mqtt.topics.commandAck
      },
      commandTopic: config.mqtt.topics.command,
      timestamp: new Date().toISOString()
    });
  });

  /**
   * GET /api/devices
   */
  router.get('/devices', (req: Request, res: Response) => {
    res.json({
      devices: stateManager.getAllDevices()
    });
  });

  /**
   * GET /api/devices/:deviceId/state
   */
  router.get('/devices/:deviceId/state', (req: Request, res: Response) => {
    const deviceId = String(req.params.deviceId || '');
    const deviceState = stateManager.getDeviceState(deviceId);

    if (!deviceState) {
      res.status(404).json({
        success: false,
        error: `Device '${deviceId}' not found.`,
        code: 'DEVICE_NOT_FOUND'
      });
      return;
    }

    res.json({
      success: true,
      data: deviceState,
      timestamp: new Date().toISOString()
    });
  });

  /**
   * POST /api/devices/:deviceId/outputs/:outputId
   * Authenticated digital output command dispatch
   */
  router.post(
    '/devices/:deviceId/outputs/:outputId',
    requireAuth,
    validateDeviceAndOutput,
    async (req: Request, res: Response) => {
      const deviceId = String(req.params.deviceId || '');
      const outputId = String(req.params.outputId || '') as 'DO1' | 'DO2';
      const { state } = req.body;

      if (typeof state !== 'boolean') {
        res.status(400).json({
          success: false,
          error: "Payload must contain a boolean 'state' field (true for ON, false for OFF).",
          code: 'INVALID_STATE_VALUE'
        });
        return;
      }

      logger.info(`Output command initiated: ${deviceId} -> ${outputId} = ${state}`);

      // If in demo mode or simulation is active, handle simulated ACK
      if (simulator.isActive()) {
        stateManager.setPendingOutput(deviceId, outputId, state);
        setTimeout(() => {
          simulator.setSimulatedOutput(outputId, state);
        }, 600);

        res.json({
          success: true,
          status: 'pending',
          message: `[DEMO MODE] Command queued for ${outputId}=${state ? 'ON' : 'OFF'}. Simulating device response.`,
          output: outputId,
          state
        });
        return;
      }

      // Check if command control is configured for real device
      if (!config.commandControl.enabled) {
        res.status(503).json({
          success: false,
          error: 'Device output control protocol is not configured. Guessing commands is prevented.',
          code: 'CONTROL_NOT_CONFIGURED'
        });
        return;
      }

      const result = await mqttService.publishCommand(
        deviceId,
        outputId,
        state
      );

      if (!result.success) {
        res.status(500).json({
          success: false,
          error: result.message,
          code: 'COMMAND_DISPATCH_FAILED'
        });
        return;
      }

      res.json({
        success: true,
        status: 'pending',
        message: result.message,
        output: outputId,
        state
      });
    }
  );

  /**
   * POST /api/demo/toggle
   * Allows toggling demo mode from settings / dashboard
   */
  router.post('/demo/toggle', requireAuth, (req: Request, res: Response) => {
    const { enable } = req.body;
    if (typeof enable === 'boolean') {
      if (enable) {
        simulator.start();
      } else {
        simulator.stop();
      }
    }
    res.json({
      demoMode: simulator.isActive()
    });
  });

  return router;
}

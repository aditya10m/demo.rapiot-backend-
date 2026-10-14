import http from 'http';
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import rateLimit from 'express-rate-limit';

import { config } from './config/index.js';
import { logger } from './services/logger.js';
import { DeviceStateManager } from './services/stateManager.js';
import { MQTTService } from './mqtt/mqttClient.js';
import { SimulatorService } from './services/simulator.js';
import { createApiRouter } from './routes/api.js';

const app: Express = express();
const server = http.createServer(app);

// Configure Socket.IO
const io = new SocketIOServer(server, {
  cors: {
    origin: config.corsOrigin === '*' ? true : config.corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 10000,
  pingInterval: 5000,
});

// Services Initialization
const stateManager = new DeviceStateManager(config);
const mqttService = new MQTTService(config, stateManager);
const simulator = new SimulatorService(config, stateManager);

// Express Middleware
app.use(cors({
  origin: config.corsOrigin === '*' ? true : config.corsOrigin,
  credentials: true,
}));
app.use(express.json());

// Global Rate Limiting: 200 requests per 15 minutes per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Too many requests from this IP, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

// Strict Rate Limiting for Output Controls: 30 command actions per minute per IP
const controlLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many command control requests, please throttle interactions.' },
});
app.use('/api/devices/:deviceId/outputs', controlLimiter);

// Mount API routes
app.use('/api', createApiRouter(config, stateManager, mqttService, simulator));

// Central error handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled API Error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal Server Error'
  });
});

// Socket.IO Real-Time Dispatcher
io.on('connection', (socket) => {
  logger.info(`Socket client connected: ${socket.id} (IP: ${socket.handshake.address})`);

  // Send initial device snapshot immediately upon connection
  socket.emit('initial_state', {
    devices: stateManager.getAllDevices(),
    mqttStatus: stateManager.getMqttStatus(),
    demoMode: simulator.isActive(),
    commandControlEnabled: config.commandControl.enabled
  });

  socket.on('disconnect', (reason) => {
    logger.info(`Socket client disconnected: ${socket.id} (reason: ${reason})`);
  });
});

// Forward State Manager events to all connected Socket.IO clients
stateManager.on('telemetry', (telemetry) => {
  io.emit('telemetry', telemetry);
});

stateManager.on('device_updated', (deviceState) => {
  io.emit('device_state', deviceState);
});

// Connect to real MQTT Broker
mqttService.connect();

// Start Demo Simulator if DEMO_MODE=true
if (config.demoMode) {
  simulator.start();
}

// Start HTTP/WebSocket Server
const PORT = config.port;
server.listen(PORT, () => {
  logger.info(`========================================================`);
  logger.info(`  RAPIOT Live Monitor Backend running on port ${PORT}`);
  logger.info(`  Environment: ${config.nodeEnv}`);
  logger.info(`  MQTT Broker: ${config.mqtt.protocol}://${config.mqtt.host}:${config.mqtt.port}`);
  logger.info(`  Client ID:   ${config.mqtt.clientId}`);
  logger.info(`  Demo Mode:   ${config.demoMode ? 'ENABLED (Simulating Telemetry)' : 'DISABLED (Real Broker Only)'}`);
  logger.info(`========================================================`);
});

// Graceful Shutdown handling
function shutdown(signal: string) {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  simulator.stop();
  stateManager.destroy();

  mqttService.disconnect().finally(() => {
    server.close(() => {
      logger.info('HTTP server and WebSockets closed. Process exiting.');
      process.exit(0);
    });
  });

  // Force exit if hanging
  setTimeout(() => {
    logger.error('Graceful shutdown timed out, force killing process.');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

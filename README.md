# RAPIOT Live Monitor - Backend Service

Production-ready, resilient Node.js / TypeScript backend service for the RAPIOT Industrial IoT platform.

Co-located on an Ubuntu VPS with Mosquitto MQTT broker, it connects via `MQTT.js`, ingests and normalizes device telemetry, manages device connectivity states, and streams updates to frontend dashboards in real-time via `Socket.IO` and REST APIs.

## Architecture

- **MQTT Client**: Connects locally (`127.0.0.1:1883`) or over secure TLS to Mosquitto.
- **Dynamic Telemetry Parser**: Flexible field mapping and boolean representation normalizer without data coercion.
- **State Manager**: Detects timeouts, manages staleness, and tracks pending actuator states.
- **Command Adapter**: Validates and serializes commands for `DO1` and `DO2`.
- **Security & Authorization**: Bearer token authentication, rate limiting, and parameter allowlists.

## Quickstart

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env

# 3. Build TypeScript
npm run build

# 4. Start with PM2 on Ubuntu VPS
pm2 start dist/server.js --name "rapiot-backend"
pm2 save
```

## Running Tests

```bash
npm run build
npx tsx --test tests/*.test.ts
```

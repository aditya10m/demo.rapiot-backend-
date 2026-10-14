import { Request, Response, NextFunction } from 'express';
import { config } from '../config/index.js';
import { logger } from '../services/logger.js';

/**
 * Authentication middleware for output control endpoints.
 * Requires Bearer token or x-api-key header matching API_SECRET_TOKEN.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'] as string | undefined;

  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (apiKeyHeader) {
    token = apiKeyHeader.trim();
  }

  if (!token || token !== config.apiSecretToken) {
    logger.warn(`Unauthorized control attempt from IP ${req.ip} to ${req.originalUrl}`);
    res.status(401).json({
      success: false,
      error: 'Unauthorized: Missing or invalid API secret token.',
      code: 'AUTH_REQUIRED'
    });
    return;
  }

  next();
}

/**
 * Validates deviceId and outputId against allowlists
 */
export function validateDeviceAndOutput(req: Request, res: Response, next: NextFunction): void {
  const deviceId = String(req.params.deviceId || '');
  const outputId = req.params.outputId !== undefined ? String(req.params.outputId) : undefined;

  // Check device allowlist
  if (!deviceId || !config.allowedDeviceIds.includes(deviceId)) {
    res.status(400).json({
      success: false,
      error: `Invalid or disallowed deviceId: '${deviceId}'. Permitted: [${config.allowedDeviceIds.join(', ')}]`,
      code: 'INVALID_DEVICE_ID'
    });
    return;
  }

  // Check output allowlist: strictly DO1 and DO2 only (safety requirement: read-only DI1/DI2)
  if (outputId !== undefined) {
    if (outputId !== 'DO1' && outputId !== 'DO2') {
      res.status(400).json({
        success: false,
        error: `Invalid outputId '${outputId}'. Only 'DO1' and 'DO2' are controllable outputs. Digital inputs are read-only.`,
        code: 'INVALID_OUTPUT_ID'
      });
      return;
    }
  }

  next();
}

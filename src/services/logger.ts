/**
 * Secure logging utility that masks passwords, auth tokens, and sensitive strings
 */
function sanitize(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    return obj;
  }
  if (typeof obj !== 'object') return obj;

  const sensitiveKeys = ['password', 'secret', 'token', 'authorization', 'key', 'credential'];
  
  if (Array.isArray(obj)) {
    return obj.map(sanitize);
  }

  const sanitized: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (sensitiveKeys.some(s => k.toLowerCase().includes(s))) {
      sanitized[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      sanitized[k] = sanitize(v);
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

export const logger = {
  info: (msg: string, meta?: any) => {
    const timestamp = new Date().toISOString();
    if (meta !== undefined) {
      console.log(`[${timestamp}] [INFO] ${msg}`, JSON.stringify(sanitize(meta)));
    } else {
      console.log(`[${timestamp}] [INFO] ${msg}`);
    }
  },
  warn: (msg: string, meta?: any) => {
    const timestamp = new Date().toISOString();
    if (meta !== undefined) {
      console.warn(`[${timestamp}] [WARN] ${msg}`, JSON.stringify(sanitize(meta)));
    } else {
      console.warn(`[${timestamp}] [WARN] ${msg}`);
    }
  },
  error: (msg: string, error?: any) => {
    const timestamp = new Date().toISOString();
    if (error !== undefined) {
      const errDetail = error instanceof Error 
        ? { message: error.message, stack: error.stack }
        : sanitize(error);
      console.error(`[${timestamp}] [ERROR] ${msg}`, JSON.stringify(errDetail));
    } else {
      console.error(`[${timestamp}] [ERROR] ${msg}`);
    }
  },
  debug: (msg: string, meta?: any) => {
    if (process.env.NODE_ENV === 'production') return;
    const timestamp = new Date().toISOString();
    if (meta !== undefined) {
      console.log(`[${timestamp}] [DEBUG] ${msg}`, JSON.stringify(sanitize(meta)));
    } else {
      console.log(`[${timestamp}] [DEBUG] ${msg}`);
    }
  }
};

import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import pino from 'pino';
import { pinoHttp } from 'pino-http';

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info');
const pretty = process.env.LOG_PRETTY === 'true';

/** Structured JSON logs (pretty-printed locally with LOG_PRETTY=true). Secrets are redacted. */
export const logger = pino({
  level,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.new_password',
      '*.current_password',
      '*.token',
      '*.refresh_token',
    ],
    censor: '[redacted]',
  },
  ...(pretty && { transport: { target: 'pino-pretty', options: { singleLine: true } } }),
});

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Logs every request with a request id (accepted from X-Request-Id or generated) echoed back. */
export const httpLogger = pinoHttp({
  logger,
  genReqId(req: IncomingMessage, res: ServerResponse) {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  customLogLevel(_req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
  },
});

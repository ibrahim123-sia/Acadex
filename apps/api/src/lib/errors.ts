// Central error handling. Clients get a stable, generic message; details stay in the server log.
import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
    public code?: string
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const unauthorized = (message = 'Invalid or expired session', code?: string) => new HttpError(401, message, undefined, code);
export const forbidden = (message = 'You do not have access to this resource', code?: string) =>
  new HttpError(403, message, undefined, code);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);

// Postgres error codes we can safely translate into client errors.
const PG_ERRORS: Record<string, [number, string]> = {
  '23505': [409, 'A record with these details already exists'],
  '23503': [400, 'A referenced record does not exist'],
  '23502': [400, 'A required value is missing'],
  '23514': [400, 'A value is not allowed'],
  '22P02': [400, 'Invalid value'],
  '22003': [400, 'Number out of range'],
  '22007': [400, 'Invalid date'],
  '22008': [400, 'Invalid date'],
  '22001': [400, 'A value is too long'],
};

interface AnyError {
  type?: string;
  code?: string;
  name?: string;
}

export function toResponse(err: unknown): [number, Record<string, unknown>] {
  if (err instanceof HttpError) {
    return [
      err.status,
      { error: err.message, ...(err.code && { code: err.code }), ...(err.details !== undefined && { details: err.details }) },
    ];
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return [400, { error: 'Invalid request', details }];
  }
  const e = (err || {}) as AnyError;
  if (e.type === 'entity.parse.failed') return [400, { error: 'Malformed JSON body' }];
  if (e.type === 'entity.too.large') return [413, { error: 'Request body too large' }];
  if (e.code && PG_ERRORS[e.code]) {
    const [status, error] = PG_ERRORS[e.code]!;
    return [status, { error }];
  }
  return [500, { error: 'Something went wrong' }];
}

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  const [status, body] = toResponse(err);
  if (status >= 500) {
    if (req.log) req.log.error({ err }, 'request failed');
    else console.error(`[${req.method} ${req.originalUrl}]`, err);
  }
  if (res.headersSent) {
    res.end(); // e.g. a PDF stream that failed midway
    return;
  }
  if (!next) return;
  res.status(status).json({ ...body, ...(req.id && status >= 500 && { request_id: String(req.id) }) });
};

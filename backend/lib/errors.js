// Central error handling. Clients get a stable, generic message; details stay in the server log.

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (message, details) => new HttpError(400, message, details);
const forbidden = (message = 'You do not have access to this resource') => new HttpError(403, message);
const notFound = (message = 'Not found') => new HttpError(404, message);

// Postgres error codes we can safely translate into client errors.
const PG_ERRORS = {
  23505: [409, 'A record with these details already exists'],
  23503: [400, 'A referenced record does not exist'],
  23502: [400, 'A required value is missing'],
  23514: [400, 'A value is not allowed'],
  '22P02': [400, 'Invalid value'],
  22003: [400, 'Number out of range'],
  22007: [400, 'Invalid date'],
  22008: [400, 'Invalid date'],
  22001: [400, 'A value is too long'],
};

function toResponse(err) {
  if (err instanceof HttpError) return [err.status, { error: err.message, ...(err.details && { details: err.details }) }];
  if (err && err.name === 'ZodError') {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return [400, { error: 'Invalid request', details }];
  }
  if (err && err.type === 'entity.parse.failed') return [400, { error: 'Malformed JSON body' }];
  if (err && err.type === 'entity.too.large') return [413, { error: 'Request body too large' }];
  if (err && PG_ERRORS[err.code]) {
    const [status, error] = PG_ERRORS[err.code];
    return [status, { error }];
  }
  return [500, { error: 'Something went wrong' }];
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const [status, body] = toResponse(err);
  if (status >= 500) console.error(`[${req.method} ${req.originalUrl}]`, err);
  if (res.headersSent) return res.end(); // e.g. a PDF stream that failed midway
  res.status(status).json(body);
}

module.exports = { HttpError, badRequest, forbidden, notFound, errorHandler };

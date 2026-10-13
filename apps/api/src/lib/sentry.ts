// Error reporting (only when SENTRY_DSN is set). Request bodies, cookies and auth headers
// are never sent; only server errors (5xx) are reported.
import * as Sentry from '@sentry/node';

let enabled = false;

export function initSentry(dsn: string | undefined, environment: string) {
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment,
    release: process.env.RELEASE,
    tracesSampleRate: 0.05,
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        if (event.request.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
        }
      }
      return event;
    },
  });
  enabled = true;
}

export function captureServerError(err: unknown, context: { requestId?: string; method?: string; path?: string; userId?: number }) {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (context.requestId) scope.setTag('request_id', context.requestId);
    if (context.userId) scope.setUser({ id: String(context.userId) }); // id only, no email/name
    scope.setContext('request', { method: context.method, path: context.path });
    Sentry.captureException(err);
  });
}

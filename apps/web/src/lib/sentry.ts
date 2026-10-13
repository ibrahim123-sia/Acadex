import * as Sentry from '@sentry/react';

/** Error reporting, only when VITE_SENTRY_DSN is configured. No personal data is attached. */
export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_RELEASE as string | undefined,
    tracesSampleRate: 0.1,
    beforeSend(event) {
      // never ship tokens that might appear in URLs (invite / reset links)
      if (event.request?.url) event.request.url = event.request.url.replace(/#token=[^&]+/, '#token=[redacted]');
      return event;
    },
  });
}

export const ErrorBoundary = Sentry.ErrorBoundary;

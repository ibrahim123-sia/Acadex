// API client. The access token lives only in memory (never localStorage); when it expires the
// client silently exchanges the httpOnly refresh cookie for a new one and retries once.
import type { ApiErrorBody, AuthResponse } from '@acadex/shared';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown
  ) {
    super(message);
  }
  /** First field-level validation message, if any. */
  get fieldMessage(): string | undefined {
    const d = this.details;
    if (Array.isArray(d) && d[0] && typeof d[0].message === 'string') return d[0].message;
    return undefined;
  }
}

/** Human-readable message for any error thrown by the client. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiError) return err.fieldMessage ?? err.message ?? fallback;
  if (err instanceof TypeError) return 'Cannot reach the server. Check your connection.';
  return fallback;
}

let accessToken: string | null = null;
let refreshInFlight: Promise<AuthResponse | null> | null = null;
const sessionEndedListeners = new Set<() => void>();

export const tokenStore = {
  get: () => accessToken,
  set: (token: string | null) => {
    accessToken = token;
  },
};

/** Called when the session can't be renewed (signed out elsewhere, expired, revoked). */
export function onSessionEnded(fn: () => void): () => void {
  sessionEndedListeners.add(fn);
  return () => sessionEndedListeners.delete(fn);
}

const baseHeaders = (): Record<string, string> => ({
  'X-Acadex-Client': 'web',
  ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
});

/** Exchange the refresh cookie for a new access token (one request at a time). */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'X-Acadex-Client': 'web' } });
      if (!res.ok) {
        accessToken = null;
        return null;
      }
      const data = (await res.json()) as AuthResponse;
      accessToken = data.access_token;
      return data;
    } catch {
      return null; // offline: keep the current state, callers decide
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

type Query = Record<string, string | number | boolean | null | undefined>;

interface RequestOptions {
  body?: unknown;
  /** multipart upload instead of JSON */
  form?: FormData;
  query?: Query;
  signal?: AbortSignal;
  /** don't try to refresh on 401 (auth endpoints themselves) */
  noRefresh?: boolean;
}

function url(path: string, query?: Query) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return `${BASE}${path}${s ? `?${s}` : ''}`;
}

async function send(method: string, path: string, opts: RequestOptions, retried = false): Promise<Response> {
  const tokenUsed = accessToken;
  const res = await fetch(url(path, opts.query), {
    method,
    credentials: 'include',
    signal: opts.signal,
    headers: { ...baseHeaders(), ...(opts.body !== undefined && !opts.form ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  if (res.status === 401 && !opts.noRefresh && !retried && tokenUsed !== null) {
    // another request may already have renewed the token while this one was in flight
    if (accessToken && accessToken !== tokenUsed) return send(method, path, opts, true);
    const renewed = await refreshSession();
    if (renewed) return send(method, path, opts, true);
    sessionEndedListeners.forEach((fn) => fn());
  }
  return res;
}

async function toError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody | undefined;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    /* not JSON */
  }
  const message = body?.error ?? (res.status === 429 ? 'Too many attempts. Please wait a moment.' : `Request failed (${res.status})`);
  return new ApiError(res.status, message, body?.code, body?.details);
}

async function json<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await send(method, path, opts);
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => json<T>('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'body'> = {}) => json<T>('POST', path, { ...opts, body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => json<T>('PATCH', path, { body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => json<T>('PUT', path, { body: body ?? {} }),
  delete: <T>(path: string, body?: unknown) => json<T>('DELETE', path, body === undefined ? {} : { body }),

  /** Multipart upload: one file in the "file" field plus text fields. */
  upload: <T>(method: 'POST' | 'PUT', path: string, file: File, fields: Record<string, string> = {}) => {
    const form = new FormData();
    form.append('file', file);
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return json<T>(method, path, { form });
  },

  /** A protected file as a Blob (e.g. to show a photo: <img> can't send the access token). */
  async blob(path: string, signal?: AbortSignal): Promise<Blob> {
    const res = await send('GET', path, { signal });
    if (!res.ok) throw await toError(res);
    return res.blob();
  },

  /** A page of a paginated list (total from X-Total-Count). */
  async page<T>(path: string, query: Query = {}, signal?: AbortSignal): Promise<Page<T>> {
    const res = await send('GET', path, { query, signal });
    if (!res.ok) throw await toError(res);
    const rows = (await res.json()) as T[];
    return {
      rows,
      total: Number(res.headers.get('X-Total-Count') ?? rows.length),
      page: Number(res.headers.get('X-Page') ?? query.page ?? 1),
      pageSize: Number(res.headers.get('X-Page-Size') ?? query.pageSize ?? rows.length),
    };
  },

  /** Every row of a paginated list (pages of 100, up to maxRows). */
  async all<T>(path: string, query: Query = {}, maxRows = 2000): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; out.length < maxRows; page++) {
      const p = await api.page<T>(path, { ...query, page, pageSize: 100 });
      out.push(...p.rows);
      if (out.length >= p.total || p.rows.length < 100) break;
    }
    return out;
  },

  /** Download a file (e.g. a PDF) and hand it to the browser. */
  async download(path: string, filename: string): Promise<void> {
    const res = await send('GET', path, {});
    if (!res.ok) throw await toError(res);
    const blobUrl = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  },
};

// Acadex on Cloudflare — one Worker in front of everything (see docs/cloudflare.md).
//
//   browser ──► Worker ──► static assets (apps/web/dist)       every path except /api/*
//                     └──► AcadexApi container (apps/api)       /api/*  (Express on port 5000)
//   cron trigger ──► Worker.scheduled ──► POST /api/internal/cron in the container
//
// The API itself is unchanged: it runs from apps/api/Dockerfile, reads the same environment
// variables as anywhere else, keeps its data in Neon (DATABASE_URL) and its files in R2 through
// the S3 driver. Every string var and secret of this Worker is passed to the container as an
// environment variable, so configuring the API = `wrangler secret put NAME` or a "vars" entry.
import { Container, getContainer, getRandom } from '@cloudflare/containers';

export interface Env {
  /** the built web app (wrangler.jsonc → assets) */
  ASSETS: Fetcher;
  /** the API container (wrangler.jsonc → durable_objects / containers) */
  API: DurableObjectNamespace<AcadexApi>;
  /** how many API containers share the traffic (default 1) */
  API_INSTANCES?: string;
  /** shared secret for the scheduled tick; without it the cron trigger does nothing */
  CRON_SECRET?: string;
  /** every other var / secret is configuration for the API */
  [name: string]: unknown;
}

/** The string-valued vars and secrets (bindings are objects and stay in the Worker). */
function apiEnvironment(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string' && k !== 'API_INSTANCES') out[k] = v;
  return out;
}

export class AcadexApi extends Container<Env> {
  defaultPort = 5000;
  /** stop the container after this long without requests (the cron tick also counts as one) */
  sleepAfter = '15m';

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    this.envVars = {
      NODE_ENV: 'production',
      // the Worker is the one proxy in front: trust its X-Forwarded-For for the client's address
      TRUST_PROXY: 'true',
      // a sleeping container misses pg-boss schedules, so the cron trigger drives them
      JOBS_SCHEDULE: env.CRON_SECRET ? 'external' : 'internal',
      ...apiEnvironment(env),
      PORT: '5000',
    };
  }

  override onError(error: unknown): never {
    console.error('API container error', error);
    throw error;
  }
}

async function api(env: Env) {
  const n = Math.max(1, Math.min(10, Number(env.API_INSTANCES ?? '1') || 1));
  return n === 1 ? getContainer(env.API, 'main') : getRandom(env.API, n);
}

/** Headers a browser must not be able to set on the way to the API. */
const STRIP = ['x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-real-ip', 'x-acadex-cron'];

async function toApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  // infrastructure-only routes are reachable from the cron trigger, never from the internet
  if (url.pathname.startsWith('/api/internal/')) return Response.json({ success: false, message: 'Not found' }, { status: 404 });
  const headers = new Headers(request.headers);
  for (const h of STRIP) headers.delete(h);
  headers.set('x-forwarded-for', request.headers.get('cf-connecting-ip') ?? '');
  headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
  headers.set('x-forwarded-host', url.host);
  const container = await api(env);
  return container.fetch(new Request(request, { headers }));
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return toApi(request, env);
    // assets are matched before the Worker runs; this covers anything that reaches it anyway
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx): Promise<void> {
    if (!env.CRON_SECRET) return;
    const container = await api(env);
    const tick = container.fetch(
      new Request('https://acadex.internal/api/internal/cron', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-acadex-cron': env.CRON_SECRET },
        body: JSON.stringify({ at: new Date(event.scheduledTime).toISOString(), window_minutes: 5 }),
      })
    );
    ctx.waitUntil(
      tick.then(async (res) => {
        if (!res.ok) console.error('cron tick failed', res.status, await res.text());
      })
    );
  },
} satisfies ExportedHandler<Env>;

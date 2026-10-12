// Environment configuration, validated once at startup. The server refuses to boot with
// an unsafe configuration instead of failing later at the first login.
const { z } = require('zod');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z.string({ error: 'DATABASE_URL is required' }).min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z
    .string({ error: 'JWT_SECRET is required' })
    .min(32, 'JWT_SECRET must be at least 32 characters (generate one with: openssl rand -hex 32)'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  // Comma-separated list of browser origins allowed to call the API.
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://127.0.0.1:3000'),
  // Set when running behind a proxy/load balancer so rate limits see the real client IP.
  TRUST_PROXY: z.string().default('false'),
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(10), // attempts per 15 min per IP+email
  API_RATE_LIMIT: z.coerce.number().int().positive().default(600), // requests per minute per IP
});

function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  const c = parsed.data;
  const trustProxy = c.TRUST_PROXY === 'true' ? 1 : c.TRUST_PROXY === 'false' ? false : c.TRUST_PROXY;
  return {
    env: c.NODE_ENV,
    port: c.PORT,
    jwtSecret: c.JWT_SECRET,
    jwtExpiresIn: c.JWT_EXPIRES_IN,
    corsOrigins: c.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy,
    loginRateLimit: c.LOGIN_RATE_LIMIT,
    apiRateLimit: c.API_RATE_LIMIT,
  };
}

module.exports = { loadConfig };

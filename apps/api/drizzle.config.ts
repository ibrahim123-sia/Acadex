import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit only *generates* SQL here (npm run db:generate). Migrations are applied by
// src/db/migrate.ts, which adds checksums, a lock and the destructive-statement guard.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});

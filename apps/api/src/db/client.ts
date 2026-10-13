import { drizzle } from 'drizzle-orm/node-postgres';
import { pool } from './pool';
import * as schema from './schema';

/** Typed query builder over the shared pool. Heavy reporting queries may use raw SQL. */
export const db = drizzle(pool, { schema });
export type Db = typeof db;
export { schema };

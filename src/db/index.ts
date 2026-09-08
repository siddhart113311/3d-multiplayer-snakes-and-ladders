import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
// Keep route modules importable when a deployment forgot DATABASE_URL. The
// first query is guarded by ensureDatabase(), which returns an actionable 503
// instead of Next.js failing while evaluating this module.
const connectionString =
  databaseUrl ?? "postgresql://unconfigured:unconfigured@127.0.0.1:5432/unconfigured";

const isLocalhost =
  !databaseUrl ||
  databaseUrl.includes("127.0.0.1") ||
  databaseUrl.includes("localhost");

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString,
    // Fail fast in serverless deployments instead of leaving Create Lobby
    // spinning until the platform request timeout.
    connectionTimeoutMillis: 8_000,
    idleTimeoutMillis: 30_000,
    max: process.env.NODE_ENV === "production" ? 5 : 10,
    ssl: isLocalhost ? undefined : { rejectUnauthorized: false },
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);

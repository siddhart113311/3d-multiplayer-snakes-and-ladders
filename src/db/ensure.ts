import { pool } from "@/db";

/**
 * Lazily bootstrap the tiny multiplayer schema.
 *
 * Hosted databases (Neon/Supabase/Railway/etc.) are often empty on the first
 * deployment. Previously Create Lobby failed with a generic 500 until someone
 * manually ran drizzle-kit push. These idempotent statements make the app
 * ready on its first API request while Drizzle remains the ORM used by every
 * game query.
 */
let ready: Promise<void> | null = null;

export function ensureDatabase(): Promise<void> {
  if (!ready) {
    ready = bootstrap().catch((error) => {
      // A transient connection failure must be retryable on the next request.
      ready = null;
      throw error;
    });
  }
  return ready;
}

async function bootstrap() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not configured. Online multiplayer requires PostgreSQL. Add DATABASE_URL to your hosting provider's environment variables."
    );
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    // Prevent two cold serverless instances racing the initial bootstrap.
    await client.query("select pg_advisory_xact_lock(739371001)");
    await client.query(`
      create table if not exists games (
        id uuid primary key default gen_random_uuid(),
        code text not null unique,
        status text not null default 'waiting',
        state jsonb not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await client.query("create index if not exists games_code_idx on games (code)");
    await client.query(`
      create table if not exists scores (
        id serial primary key,
        name text not null,
        score integer not null,
        mode text not null default 'classic',
        board text not null default 'square',
        won boolean not null default false,
        turns integer not null default 0,
        created_at timestamptz not null default now()
      )
    `);
    await client.query("create index if not exists scores_score_idx on scores (score)");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function databaseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[Multiplayer Database Error]:", error);

  if (!process.env.DATABASE_URL) return "Online multiplayer is not configured: DATABASE_URL is missing.";

  if (
    (process.env.VERCEL || process.env.NODE_ENV === "production") &&
    (process.env.DATABASE_URL.includes("127.0.0.1") || process.env.DATABASE_URL.includes("localhost"))
  ) {
    return "DATABASE_URL is set to localhost/127.0.0.1 on Vercel. Vercel cannot reach your local machine. Please configure a cloud PostgreSQL database (e.g. Neon, Supabase).";
  }

  if (/password authentication failed/i.test(message)) return "The multiplayer database rejected its credentials. Check DATABASE_URL.";
  if (/ENOTFOUND|getaddrinfo/i.test(message)) return "The multiplayer database host could not be found. Check DATABASE_URL.";
  if (/ECONNREFUSED|connect ECONN/i.test(message)) return "The multiplayer database is unreachable. Check DATABASE_URL and its network access rules.";
  if (/ETIMEDOUT|timeout/i.test(message)) return "The multiplayer database connection timed out. Check your database network rules or connection string.";
  if (/SSL|certificate|no encryption/i.test(message)) return "The multiplayer database rejected the connection due to SSL. Check your database SSL settings.";
  if (/does not exist/i.test(message) && /database/i.test(message)) return "The database named in DATABASE_URL does not exist.";
  return "Online multiplayer is temporarily unavailable. Please retry in a moment.";
}

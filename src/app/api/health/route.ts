import { db } from "@/db";
import { databaseError, ensureDatabase } from "@/db/ensure";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureDatabase();
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, database: "ready", multiplayer: true });
  } catch (e) {
    return Response.json(
      { ok: false, database: "unavailable", multiplayer: false, error: databaseError(e) },
      { status: 503 }
    );
  }
}

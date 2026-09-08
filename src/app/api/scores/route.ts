import { db } from "@/db";
import { databaseError, ensureDatabase } from "@/db/ensure";
import { scores } from "@/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureDatabase();
    const rows = await db.select().from(scores).orderBy(desc(scores.score)).limit(10);
    return Response.json({ scores: rows });
  } catch (e) {
    console.error("Read scores failed:", e);
    return Response.json({ error: databaseError(e), scores: [] }, { status: 503 });
  }
}

export async function POST(req: Request) {
  try {
    await ensureDatabase();
    const body = await req.json();
    const name = String(body?.name ?? "Player").slice(0, 14) || "Player";
    const score = Math.max(0, Math.min(100000, Math.round(Number(body?.score ?? 0))));
    const mode = body?.mode === "fire" ? "fire" : "classic";
    const board = ["square", "hex", "triangle"].includes(body?.board) ? body.board : "square";
    const won = Boolean(body?.won);
    const turns = Math.max(0, Math.round(Number(body?.turns ?? 0)));
    const [row] = await db.insert(scores).values({ name, score, mode, board, won, turns }).returning();
    return Response.json({ ok: true, score: row });
  } catch (e) {
    console.error("Save score failed:", e);
    return Response.json({ error: databaseError(e) }, { status: 503 });
  }
}

import { db } from "@/db";
import { databaseError, ensureDatabase } from "@/db/ensure";
import { games } from "@/db/schema";
import { advanceWorld, GameState, normalizeState, publicState } from "@/game/engine";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** Poll game state. Advances fire-mode snakes server-side so all clients stay in sync. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await ensureDatabase();
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const pid = url.searchParams.get("pid") ?? undefined;

    const rows = await db.select().from(games).where(eq(games.id, id)).limit(1);
    const row = rows[0];
    if (!row) return Response.json({ error: "not found" }, { status: 404 });

    const state = normalizeState(row.state as unknown as GameState);
    const before = state.seq;
    advanceWorld(state, Date.now());
    if (state.seq !== before) {
      await db.update(games).set({ state, status: state.status, updatedAt: new Date() }).where(eq(games.id, id));
    }

    return Response.json({ gameId: id, code: row.code, state: publicState(state, pid), serverNow: Date.now() });
  } catch (e) {
    console.error("Read game failed:", e);
    return Response.json({ error: databaseError(e) }, { status: 503 });
  }
}

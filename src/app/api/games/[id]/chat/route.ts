import { db } from "@/db";
import { databaseError, ensureDatabase } from "@/db/ensure";
import { games } from "@/db/schema";
import { addChat, GameState, normalizeState, publicState } from "@/game/engine";
import { triggerGameEvent } from "@/lib/pusher/server";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await ensureDatabase();
  } catch (e) {
    console.error("Chat database unavailable:", e);
    return Response.json({ error: databaseError(e) }, { status: 503 });
  }
  const { id } = await ctx.params;
  let body: { pid?: string; secret?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad body" }, { status: 400 });
  }

  const text = String(body.text ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
  if (!text) return Response.json({ error: "empty message" }, { status: 400 });

  const rows = await db.select().from(games).where(eq(games.id, id)).limit(1);
  const row = rows[0];
  if (!row) return Response.json({ error: "not found" }, { status: 404 });

  const state = normalizeState(row.state as unknown as GameState);
  const me = state.players.find((p) => p.id === body.pid);
  if (!me || me.secret !== body.secret) return Response.json({ error: "unauthorized" }, { status: 401 });

  // light rate limit: max 1 message per 700ms per player
  const lastMine = [...state.chat].reverse().find((m) => m.playerId === me.id);
  if (lastMine && Date.now() - lastMine.at < 700) {
    return Response.json({ error: "Slow down!" }, { status: 429 });
  }

  addChat(state, { playerId: me.id, name: me.name, color: me.color, text });
  await db.update(games).set({ state, updatedAt: new Date() }).where(eq(games.id, id));

  await triggerGameEvent([id, row.code], "game-updated", {
    code: row.code,
    state: publicState(state),
    serverNow: Date.now(),
  });

  return Response.json({ ok: true, state: publicState(state, me.id), serverNow: Date.now() });
}

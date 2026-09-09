import { db } from "@/db";
import { databaseError, ensureDatabase } from "@/db/ensure";
import { games } from "@/db/schema";
import { addPlayer, GameState, logLinePublic, normalizeState, publicState, publicStateBroadcast } from "@/game/engine";
import { getCachedGame, setCachedGame } from "@/game/gameCache";
import { triggerGameEvent } from "@/lib/pusher/server";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** Join a waiting lobby by 6-character code. */
export async function POST(req: Request) {
  try {
    await ensureDatabase();
    const body = await req.json();
    const code = String(body?.code ?? "").trim().toUpperCase();
    const name = String(body?.name ?? "Player").slice(0, 14) || "Player";
    if (code.length < 4) return Response.json({ error: "Enter a valid code" }, { status: 400 });

    let gameId: string;
    let state: GameState;
    const cached = getCachedGame(code);

    if (cached) {
      gameId = cached.id;
      state = cached.state;
    } else {
      const rows = await db.select().from(games).where(eq(games.code, code)).limit(1);
      const row = rows[0];
      if (!row) return Response.json({ error: "No lobby found with that code" }, { status: 404 });
      state = normalizeState(row.state as unknown as GameState);
      gameId = row.id;
    }

    if (state.status !== "waiting") {
      return Response.json({ error: "That game already started" }, { status: 400 });
    }
    const player = addPlayer(state, name, false);
    if (!player) return Response.json({ error: "Lobby is full (4 players)" }, { status: 400 });
    logLinePublic(state, `${player.name} joined the lobby`);

    await db.update(games).set({ state, updatedAt: new Date() }).where(eq(games.id, gameId));
    setCachedGame(gameId, code, state);

    const pub = publicStateBroadcast(state);
    await Promise.allSettled([
      triggerGameEvent([gameId, code], "lobby-updated", {
        code,
        state: pub,
        serverNow: Date.now(),
      }),
      triggerGameEvent([gameId, code], "game-updated", {
        code,
        state: pub,
        serverNow: Date.now(),
      }),
    ]);

    return Response.json({ gameId, code, playerId: player.id, secret: player.secret, status: state.status });
  } catch (e) {
    console.error("Join lobby failed:", e);
    return Response.json({ error: databaseError(e) }, { status: 503 });
  }
}

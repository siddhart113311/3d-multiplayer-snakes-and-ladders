import { db } from "@/db";
import { databaseError, ensureDatabase } from "@/db/ensure";
import { games } from "@/db/schema";
import { BoardShape, BOARD_SHAPES, clampSize, DEFAULT_SIZE } from "@/game/boards";
import { addPlayer, createState, GameMode, startGame } from "@/game/engine";
import { setCachedGame } from "@/game/gameCache";
import { makeCode } from "@/game/rng";

export const dynamic = "force-dynamic";

/** Create a lobby (or an instant quick-play game vs bots). */
export async function POST(req: Request) {
  try {
    await ensureDatabase();
    const body = await req.json();
    const name = String(body?.name ?? "Player").slice(0, 14) || "Player";
    const board: BoardShape = BOARD_SHAPES.includes(body?.board) ? body.board : "square";
    const mode: GameMode = body?.mode === "fire" ? "fire" : body?.mode === "hunt" ? "hunt" : "classic";
    const quick = Boolean(body?.quick);
    const botCount = Math.min(3, Math.max(1, Number(body?.bots ?? 3)));

    let code = makeCode();
    for (let i = 0; i < 5; i++) {
      const existing = await db.select({ id: games.id }).from(games).where(eq(games.code, code)).limit(1);
      if (existing.length === 0) break;
      code = makeCode();
    }

    const size = clampSize(Number(body?.size ?? DEFAULT_SIZE));
    const state = createState(board, mode, code, size);
    const host = addPlayer(state, name, false);
    if (!host) return Response.json({ error: "lobby full" }, { status: 400 });
    if (quick) {
      for (let i = 0; i < botCount; i++) addPlayer(state, "", true);
      startGame(state);
    }

    const [row] = await db
      .insert(games)
      .values({ code, status: state.status, state })
      .returning({ id: games.id });

    setCachedGame(row.id, code, state);

    return Response.json({
      gameId: row.id,
      code,
      playerId: host.id,
      secret: host.secret,
      status: state.status,
    });
  } catch (e) {
    console.error("Create lobby failed:", e);
    return Response.json({ error: databaseError(e) }, { status: 503 });
  }
}

import { eq } from "drizzle-orm";

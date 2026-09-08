import { db } from "@/db";
import { databaseError, ensureDatabase } from "@/db/ensure";
import { games } from "@/db/schema";
import {
  addPlayer,
  advanceWorld,
  applyRoll,
  GameState,
  logLinePublic,
  normalizeState,
  publicState,
  rematch,
  startGame,
} from "@/game/engine";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Action =
  | { action: "start"; pid: string; secret: string }
  | { action: "roll"; pid: string; secret: string }
  | { action: "rematch"; pid: string; secret: string }
  | { action: "addBot"; pid: string; secret: string }
  | { action: "removeBot"; pid: string; secret: string; botId: string }
  | { action: "leave"; pid: string; secret: string };

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await ensureDatabase();
  } catch (e) {
    console.error("Game action database unavailable:", e);
    return Response.json({ error: databaseError(e) }, { status: 503 });
  }
  const { id } = await ctx.params;
  let body: Action;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad body" }, { status: 400 });
  }

  const rows = await db.select().from(games).where(eq(games.id, id)).limit(1);
  const row = rows[0];
  if (!row) return Response.json({ error: "not found" }, { status: 404 });
  const state = normalizeState(row.state as unknown as GameState);

  const me = state.players.find((p) => p.id === body.pid);
  const isHost = me && me.id === state.hostId;
  advanceWorld(state, Date.now());

  // A bot's turn may be driven by the (human) host of the lobby.
  const current = state.players[state.turn];
  const botProxy = current?.isBot && body.action === "roll" && me && !me.isBot;

  const authed =
    botProxy ||
    (me && me.secret === body.secret) ||
    (body.action === "roll" && current?.isBot && state.players.filter((p) => !p.isBot).length <= 1);

  if (!authed) return Response.json({ error: "unauthorized" }, { status: 401 });

  switch (body.action) {
    case "start": {
      if (!isHost) return Response.json({ error: "Only the host can start" }, { status: 403 });
      if (state.status !== "waiting") return Response.json({ error: "Already started" }, { status: 400 });
      if (state.players.length < 2) return Response.json({ error: "Need at least 2 players (add a bot!)" }, { status: 400 });
      startGame(state);
      break;
    }
    case "roll": {
      const roller = current?.isBot ? current : me;
      if (!roller) return Response.json({ error: "no roller" }, { status: 400 });
      const res = applyRoll(state, roller.id);
      if (!res.ok) return Response.json({ error: res.error }, { status: 400 });
      break;
    }
    case "rematch": {
      if (state.status !== "finished") return Response.json({ error: "Game not finished" }, { status: 400 });
      rematch(state, row.code);
      break;
    }
    case "addBot": {
      if (!isHost) return Response.json({ error: "Only host" }, { status: 403 });
      if (state.status !== "waiting") return Response.json({ error: "Already started" }, { status: 400 });
      const bot = addPlayer(state, "", true);
      if (!bot) return Response.json({ error: "Lobby full" }, { status: 400 });
      logLinePublic(state, `${bot.name} (bot) joined`);
      break;
    }
    case "removeBot": {
      if (!isHost) return Response.json({ error: "Only host" }, { status: 403 });
      const idx = state.players.findIndex((p) => p.id === (body as { botId: string }).botId && p.isBot);
      if (idx >= 0) state.players.splice(idx, 1);
      break;
    }
    case "leave": {
      if (state.status === "waiting" && me) {
        state.players = state.players.filter((p) => p.id !== me.id);
        if (state.hostId === me.id && state.players.length) {
          const nextHuman = state.players.find((p) => !p.isBot);
          state.hostId = (nextHuman ?? state.players[0]).id;
        }
        logLinePublic(state, `${me.name} left`);
      }
      break;
    }
  }

  await db
    .update(games)
    .set({ state, status: state.status, updatedAt: new Date() })
    .where(eq(games.id, id));

  return Response.json({
    ok: true,
    gameId: id,
    code: row.code,
    state: publicState(state, body.pid),
    serverNow: Date.now(),
    rollerSecret: undefined,
  });
}

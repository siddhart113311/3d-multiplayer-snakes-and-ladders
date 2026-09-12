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
  publicStateBroadcast,
  rematch,
  startGame,
} from "@/game/engine";
import { getCachedGame, removeCachedGame, setCachedGame } from "@/game/gameCache";
import { triggerGameEvent } from "@/lib/pusher/server";
import { eq } from "drizzle-orm";

import { RoomServiceClient } from "livekit-server-sdk";

export const dynamic = "force-dynamic";

type Action =
  | { action: "start"; pid: string; secret: string }
  | { action: "roll"; pid: string; secret: string }
  | { action: "rematch"; pid: string; secret: string }
  | { action: "addBot"; pid: string; secret: string }
  | { action: "removeBot"; pid: string; secret: string; botId: string }
  | { action: "leave"; pid: string; secret: string }
  | { action: "destroy"; pid: string; secret: string };

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

  let state: GameState;
  let code: string;
  const cached = getCachedGame(id);

  if (cached) {
    state = cached.state;
    code = cached.code;
  } else {
    const rows = await db.select().from(games).where(eq(games.id, id)).limit(1);
    const row = rows[0];
    if (!row) return Response.json({ error: "not found" }, { status: 404 });
    state = normalizeState(row.state as unknown as GameState);
    code = row.code;
    setCachedGame(id, code, state);
  }

  const me = state.players.find((p) => p.id === body.pid);
  if (me) me.lastSeen = Date.now();
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
      rematch(state, code);
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
      if (me) {
        if (state.status === "waiting") {
          if (isHost) {
            // Host leaving lobby terminates and deletes the lobby
            removeCachedGame(id);
            const targets = [id, code];
            await triggerGameEvent(targets, "game-destroyed", {
              code,
              gameId: id,
              reason: "The host left the lobby. The game has ended.",
            }).catch(() => undefined);

            if (process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) {
              try {
                const lkHost = process.env.LIVEKIT_URL.replace("wss://", "https://").replace("ws://", "http://");
                const roomService = new RoomServiceClient(lkHost, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
                await roomService.deleteRoom(code.toUpperCase()).catch(() => undefined);
              } catch (lkErr) {
                console.warn("[LiveKit] deleteRoom failed:", lkErr);
              }
            }

            await db.delete(games).where(eq(games.id, id));
            return Response.json({ ok: true, destroyed: true, gameId: id, code });
          } else {
            state.players = state.players.filter((p) => p.id !== me.id);
            logLinePublic(state, `${me.name} left`);
          }
        } else if (state.status === "playing") {
          // In active play, departing player converts to CPU bot
          me.isBot = true;
          if (!me.name.includes("(CPU)")) {
            me.name = `${me.name} (CPU)`;
          }

          if (isHost) {
            // Migrate host role to next remaining human player
            const nextHuman = state.players.find((p) => !p.isBot && !p.finished);
            if (nextHuman) {
              state.hostId = nextHuman.id;
              logLinePublic(state, `${me.name} left. ${nextHuman.name} is now host. A CPU has taken over.`);
            } else {
              // No human players remain in the game
              removeCachedGame(id);
              const targets = [id, code];
              await triggerGameEvent(targets, "game-destroyed", {
                code,
                gameId: id,
                reason: "All human players have left the game.",
              }).catch(() => undefined);

              if (process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) {
                try {
                  const lkHost = process.env.LIVEKIT_URL.replace("wss://", "https://").replace("ws://", "http://");
                  const roomService = new RoomServiceClient(lkHost, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
                  await roomService.deleteRoom(code.toUpperCase()).catch(() => undefined);
                } catch (lkErr) {
                  console.warn("[LiveKit] deleteRoom failed:", lkErr);
                }
              }

              await db.delete(games).where(eq(games.id, id));
              return Response.json({ ok: true, destroyed: true, gameId: id, code });
            }
          } else {
            logLinePublic(state, `${me.name} left. A CPU has taken over.`);
          }
        }
      }
      break;
    }
    case "destroy": {
      if (!isHost) return Response.json({ error: "Only the host can terminate and delete the game" }, { status: 403 });

      // 1. Evict from in-memory cache
      removeCachedGame(id);

      // 2. Broadcast game-destroyed over Pusher WebSockets to all connected clients
      const targets = [id, code];
      await triggerGameEvent(targets, "game-destroyed", {
        code,
        gameId: id,
        reason: "The host has terminated and deleted this game.",
      }).catch(() => undefined);

      // 3. Delete LiveKit WebRTC Voice Chat room if configured
      if (process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) {
        try {
          const lkHost = process.env.LIVEKIT_URL.replace("wss://", "https://").replace("ws://", "http://");
          const roomService = new RoomServiceClient(lkHost, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
          await roomService.deleteRoom(code.toUpperCase());
        } catch (lkErr) {
          console.warn("[LiveKit] deleteRoom failed:", lkErr);
        }
      }

      // 4. Delete game completely from PostgreSQL database
      await db.delete(games).where(eq(games.id, id));

      return Response.json({ ok: true, destroyed: true, gameId: id, code });
    }
  }

  // Update in-memory cache immediately (instant, <1ms)
  setCachedGame(id, code, state);

  const serverNow = Date.now();
  const pubForBroadcast = publicStateBroadcast(state);
  const targets = [id, code];

  // Dispatch Pusher broadcast and DB update concurrently.
  // We await Pusher trigger (fast, ~50-80ms) so other clients are notified
  // immediately without waiting behind DB writes or risking background drop.
  const pusherTriggers: Promise<boolean>[] = [
    triggerGameEvent(targets, "game-updated", {
      code,
      state: pubForBroadcast,
      serverNow,
    }),
  ];
  if (state.status === "waiting" || body.action === "start") {
    pusherTriggers.push(
      triggerGameEvent(targets, "lobby-updated", {
        code,
        state: pubForBroadcast,
        serverNow,
      })
    );
  }

  const dbPromise = db
    .update(games)
    .set({ state, status: state.status, updatedAt: new Date() })
    .where(eq(games.id, id))
    .catch((e) => {
      console.error("[action] background DB write failed:", e);
    });

  await Promise.allSettled([...pusherTriggers, dbPromise]);

  return Response.json({
    ok: true,
    gameId: id,
    code,
    state: publicState(state, body.pid),
    serverNow,
    rollerSecret: undefined,
  });
}

import { db } from "@/db";
import { databaseError, ensureDatabase } from "@/db/ensure";
import { games } from "@/db/schema";
import { advanceWorld, checkPlayerLiveness, GameState, normalizeState, publicState } from "@/game/engine";
import { getCachedGame, removeCachedGame, setCachedGame } from "@/game/gameCache";
import { triggerGameEvent } from "@/lib/pusher/server";
import { eq } from "drizzle-orm";
import { RoomServiceClient } from "livekit-server-sdk";

export const dynamic = "force-dynamic";

/** Read game state. Fast-path in-memory lookup (<5ms), advances hazards, tracks liveness. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const pid = url.searchParams.get("pid") ?? undefined;

    // 1. Check in-memory fast cache first
    let cached = getCachedGame(id);
    let rowCode = cached?.code;

    if (!cached) {
      // Cache miss (cold start / restarted instance): fall back to database
      await ensureDatabase();
      const rows = await db.select().from(games).where(eq(games.id, id)).limit(1);
      const row = rows[0];
      if (!row) return Response.json({ error: "not found" }, { status: 404 });
      const state = normalizeState(row.state as unknown as GameState);
      cached = setCachedGame(row.id, row.code, state);
      rowCode = row.code;
    }

    const state = cached.state;
    const code = rowCode || cached.code;
    const now = Date.now();

    // 2. Update caller liveness timestamp in memory (0ms DB cost)
    if (pid) {
      const caller = state.players.find((p) => p.id === pid);
      if (caller) {
        caller.lastSeen = now;
      }
    }

    // 3. Check player & host liveness (unresponsiveness detection)
    const { hostUnresponsive, changed: livenessChanged } = checkPlayerLiveness(state, now);

    if (hostUnresponsive) {
      // Host has disconnected / been unresponsive -> Terminate game
      removeCachedGame(id);
      const targets = [id, code];
      await triggerGameEvent(targets, "game-destroyed", {
        code,
        gameId: id,
        reason: "The host has disconnected or become unresponsive. Game terminated.",
      }).catch(() => undefined);

      if (process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) {
        try {
          const lkHost = process.env.LIVEKIT_URL.replace("wss://", "https://").replace("ws://", "http://");
          const roomService = new RoomServiceClient(lkHost, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
          await roomService.deleteRoom(code.toUpperCase()).catch(() => undefined);
        } catch {}
      }

      await ensureDatabase().catch(() => undefined);
      await db.delete(games).where(eq(games.id, id)).catch(() => undefined);
      return Response.json({ error: "Game terminated: host disconnected" }, { status: 404 });
    }

    // 4. Advance world hazards (fire/hunt)
    const before = state.seq;
    advanceWorld(state, now);
    const hazardAdvanced = state.seq !== before;

    // 5. If state mutated (hazard moved or player converted to bot), broadcast and persist to DB
    if (livenessChanged || hazardAdvanced) {
      cached.updatedAt = now;
      // Broadcast state update immediately via Pusher WebSockets to all players
      await triggerGameEvent([id, code], "game-updated", {
        code,
        state: publicState(state),
        serverNow: now,
      });

      // Persist state change to DB
      await ensureDatabase().catch(() => undefined);
      await db
        .update(games)
        .set({ state, status: state.status, updatedAt: new Date() })
        .where(eq(games.id, id))
        .catch((e) => console.error("Database update failed:", e));
    }

    // 6. Return response directly from hot memory (zero DB queries on normal reads)
    return Response.json({ gameId: id, code, state: publicState(state, pid), serverNow: now });
  } catch (e) {
    console.error("Read game failed:", e);
    return Response.json({ error: databaseError(e) }, { status: 503 });
  }
}

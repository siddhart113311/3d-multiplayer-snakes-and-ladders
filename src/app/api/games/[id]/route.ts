import { db } from "@/db";
import { databaseError, ensureDatabase } from "@/db/ensure";
import { games } from "@/db/schema";
import { advanceWorld, checkPlayerLiveness, GameState, normalizeState, publicState } from "@/game/engine";
import { triggerGameEvent } from "@/lib/pusher/server";
import { eq } from "drizzle-orm";
import { RoomServiceClient } from "livekit-server-sdk";

export const dynamic = "force-dynamic";

/** Poll game state. Advances fire-mode snakes server-side, tracks liveness, and handles unresponsiveness. */
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
    const now = Date.now();

    // 1. Update caller liveness timestamp if valid
    let dbDirty = false;
    if (pid) {
      const caller = state.players.find((p) => p.id === pid);
      if (caller) {
        caller.lastSeen = now;
        dbDirty = true;
      }
    }

    // 2. Check player & host liveness (unresponsiveness detection)
    const { hostUnresponsive, changed: livenessChanged } = checkPlayerLiveness(state, now);

    if (hostUnresponsive) {
      // Host has disconnected / been unresponsive >18s -> Terminate game
      const targets = [id, row.code];
      await triggerGameEvent(targets, "game-destroyed", {
        code: row.code,
        gameId: id,
        reason: "The host has disconnected or become unresponsive. Game terminated.",
      }).catch(() => undefined);

      if (process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) {
        try {
          const lkHost = process.env.LIVEKIT_URL.replace("wss://", "https://").replace("ws://", "http://");
          const roomService = new RoomServiceClient(lkHost, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
          await roomService.deleteRoom(row.code.toUpperCase()).catch(() => undefined);
        } catch {}
      }

      await db.delete(games).where(eq(games.id, id));
      return Response.json({ error: "Game terminated: host disconnected" }, { status: 404 });
    }

    // 3. Advance world hazards (fire/hunt)
    const before = state.seq;
    advanceWorld(state, now);
    if (state.seq !== before) {
      dbDirty = true;
    }

    if (livenessChanged) {
      dbDirty = true;
      // Broadcast state update since an unresponsive player transitioned to CPU
      await triggerGameEvent([id, row.code], "game-updated", {
        code: row.code,
        state: publicState(state),
        serverNow: now,
      });
    }

    if (dbDirty) {
      await db
        .update(games)
        .set({ state, status: state.status, updatedAt: new Date() })
        .where(eq(games.id, id));
    }

    return Response.json({ gameId: id, code: row.code, state: publicState(state, pid), serverNow: now });
  } catch (e) {
    console.error("Read game failed:", e);
    return Response.json({ error: databaseError(e) }, { status: 503 });
  }
}

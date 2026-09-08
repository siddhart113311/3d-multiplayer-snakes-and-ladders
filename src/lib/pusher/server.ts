import Pusher from "pusher";
import https from "https";

const appId = process.env.PUSHER_APP_ID;
const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
const secret = process.env.PUSHER_SECRET;
const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER ?? "ap2";

export const isPusherServerConfigured = Boolean(appId && key && secret);

let pusherInstance: Pusher | null = null;
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 32,
  keepAliveMsecs: 30000,
});

export function getPusherServer(): Pusher | null {
  if (!isPusherServerConfigured) return null;
  if (!pusherInstance) {
    pusherInstance = new Pusher({
      appId: appId!,
      key: key!,
      secret: secret!,
      cluster,
      useTLS: true,
      agent: httpsAgent,
    });
  }
  return pusherInstance;
}

/**
 * Broadcast an event to all clients watching a given game or lobby.
 * Accepts a room code, game UUID, or an array of identifiers.
 * Automatically broadcasts to all unique channels in a single low-latency roundtrip.
 * Safe no-op if Pusher credentials are not provided.
 */
export async function triggerGameEvent(
  target: string | string[],
  event: string,
  payload: unknown
): Promise<boolean> {
  const pusher = getPusherServer();
  if (!pusher) return false;

  try {
    const rawTargets = Array.isArray(target) ? target : [target];
    const channels = Array.from(
      new Set(
        rawTargets
          .filter(Boolean)
          .flatMap((t) => {
            const raw = t.startsWith("game-") ? t.slice(5) : t;
            return [`game-${raw.toUpperCase()}`, `game-${raw.toLowerCase()}`];
          })
      )
    );
    if (channels.length === 0) return false;

    await pusher.trigger(channels, event, payload);
    return true;
  } catch (err) {
    console.warn(`[Pusher] Failed to trigger "${event}" on channels:`, target, err);
    return false;
  }
}

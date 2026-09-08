import Pusher from "pusher";

const appId = process.env.PUSHER_APP_ID;
const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
const secret = process.env.PUSHER_SECRET;
const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER ?? "ap2";

export const isPusherServerConfigured = Boolean(appId && key && secret);

let pusherInstance: Pusher | null = null;

export function getPusherServer(): Pusher | null {
  if (!isPusherServerConfigured) return null;
  if (!pusherInstance) {
    pusherInstance = new Pusher({
      appId: appId!,
      key: key!,
      secret: secret!,
      cluster,
      useTLS: true,
    });
  }
  return pusherInstance;
}

/**
 * Broadcast an event to all clients watching a given game or lobby.
 * Safe no-op if Pusher credentials are not provided.
 */
export async function triggerGameEvent(code: string, event: string, payload: unknown): Promise<boolean> {
  const pusher = getPusherServer();
  if (!pusher) return false;

  try {
    const channel = `game-${code.toUpperCase()}`;
    await pusher.trigger(channel, event, payload);
    return true;
  } catch (err) {
    console.warn(`[Pusher] Failed to trigger "${event}" on channel game-${code}:`, err);
    return false;
  }
}

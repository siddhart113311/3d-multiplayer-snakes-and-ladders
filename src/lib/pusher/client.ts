import PusherClient from "pusher-js";

let clientInstance: PusherClient | null = null;

export const isPusherClientConfigured = Boolean(
  process.env.NEXT_PUBLIC_PUSHER_KEY && process.env.NEXT_PUBLIC_PUSHER_CLUSTER
);

export function getPusherClient(): PusherClient | null {
  if (typeof window === "undefined" || !isPusherClientConfigured) return null;

  if (!clientInstance) {
    clientInstance = new PusherClient(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER ?? "ap2",
      forceTLS: true,
      enabledTransports: ["ws", "wss"],
    });
  }

  return clientInstance;
}

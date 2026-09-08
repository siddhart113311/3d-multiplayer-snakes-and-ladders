import { AccessToken } from "livekit-server-sdk";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;

    if (!apiKey || !apiSecret || !livekitUrl) {
      return Response.json(
        { error: "LiveKit voice chat is not configured on the server" },
        { status: 503 }
      );
    }

    const body = await req.json();
    const room = String(body.room ?? "").trim().toUpperCase();
    const username = String(body.username ?? "Player").trim().slice(0, 24) || "Player";
    const identity = String(body.identity ?? username).trim() || username;

    if (!room) {
      return Response.json({ error: "Missing room parameter" }, { status: 400 });
    }

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name: username,
      ttl: "4h",
    });

    at.addGrant({
      roomJoin: true,
      room,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();
    return Response.json({ token, url: livekitUrl });
  } catch (error) {
    console.error("LiveKit token generation error:", error);
    return Response.json({ error: "Failed to create voice token" }, { status: 500 });
  }
}

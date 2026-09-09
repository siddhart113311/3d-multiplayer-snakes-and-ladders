"use client";

export interface PlayerCreds {
  pid: string;
  secret: string;
  name: string;
}

export async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    keepalive: true,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

const KEY = (gameId: string) => `serp_player_${gameId}`;

export function saveCreds(gameId: string, creds: PlayerCreds) {
  try {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(KEY(gameId), JSON.stringify(creds));
      window.localStorage.setItem(KEY(gameId), JSON.stringify(creds));
    }
  } catch {}
}

export function loadCreds(gameId: string): PlayerCreds | null {
  try {
    if (typeof window === "undefined") return null;
    const sessionRaw = window.sessionStorage.getItem(KEY(gameId));
    if (sessionRaw) return JSON.parse(sessionRaw) as PlayerCreds;
    const localRaw = window.localStorage.getItem(KEY(gameId));
    return localRaw ? (JSON.parse(localRaw) as PlayerCreds) : null;
  } catch {
    return null;
  }
}

export function clearCreds(gameId: string) {
  try {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(KEY(gameId));
      window.localStorage.removeItem(KEY(gameId));
    }
  } catch {}
}

export function saveLocalScore(entry: { name: string; score: number; mode: string; board: string; at: number }) {
  try {
    const raw = window.localStorage.getItem("serp_scores");
    const arr = raw ? (JSON.parse(raw) as Array<typeof entry>) : [];
    arr.push(entry);
    arr.sort((a, b) => b.score - a.score);
    window.localStorage.setItem("serp_scores", JSON.stringify(arr.slice(0, 10)));
  } catch {}
}

export function loadLocalScores(): Array<{ name: string; score: number; mode: string; board: string; at: number }> {
  try {
    const raw = window.localStorage.getItem("serp_scores");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

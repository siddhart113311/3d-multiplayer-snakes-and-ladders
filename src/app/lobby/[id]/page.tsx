"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Check, Copy, Crosshair, Crown, Flame, Home, Play, Trash2, Users } from "lucide-react";
import { api, clearCreds, loadCreds, PlayerCreds, saveCreds } from "@/lib/api";
import { BoardShape, cellCount, clampSize, DEFAULT_SIZE, sizeLabel } from "@/game/boards";
import { sfx } from "@/game/sounds";
import { getPusherClient } from "@/lib/pusher/client";

const VoiceChat = dynamic(() => import("@/components/VoiceChat"), { ssr: false });

interface LobbyPlayer {
  id: string;
  name: string;
  color: string;
  isBot: boolean;
  you: boolean;
}
interface LobbyState {
  status: string;
  board: string;
  size?: number;
  mode: string;
  hostId: string;
  players: LobbyPlayer[];
}

const BOARD_NAME: Record<string, string> = {
  square: "Classic Square",
  hex: "Hive Spiral",
  triangle: "Prism Peak",
};

function boardLabel(shape: string | undefined, size: number | undefined): string {
  const s = (shape ?? "square") as BoardShape;
  const sz = clampSize(size ?? DEFAULT_SIZE);
  return `${BOARD_NAME[s] ?? "Board"} · ${cellCount(s, sz)} · ${sizeLabel(s, sz)}`;
}

export default function LobbyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [state, setState] = useState<LobbyState | null>(null);
  const [code, setCode] = useState("");
  const [creds, setCreds] = useState<PlayerCreds | null>(null);
  const credsRef = useRef<PlayerCreds | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let c = loadCreds(id);
    if (!c && typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const qPid = params.get("pid");
      const qSecret = params.get("secret");
      const qName = params.get("name") || "Player";
      if (qPid && qSecret) {
        c = { pid: qPid, secret: qSecret, name: qName };
        saveCreds(id, c);
      }
    }
    if (c) {
      credsRef.current = c;
      setCreds(c);
    }
  }, [id]);

  const handleLobbyState = useCallback(
    (dataCode: string, st: LobbyState) => {
      setCode(dataCode);
      const c = credsRef.current ?? loadCreds(id);
      if (c && !credsRef.current) {
        credsRef.current = c;
        setCreds(c);
      }
      const taggedPlayers = st.players.map((p) => ({
        ...p,
        you: Boolean(c?.pid && p.id === c.pid),
      }));
      const updatedState = { ...st, players: taggedPlayers };
      setState(updatedState);
      if (updatedState.status === "playing" && updatedState.players.some((p) => p.you)) {
        router.replace(`/game/${id}`);
      }
    },
    [id, router]
  );

  const handleLobbyStateRef = useRef(handleLobbyState);
  handleLobbyStateRef.current = handleLobbyState;
  const codeRef = useRef(code);
  codeRef.current = code;

  const poll = useCallback(async () => {
    try {
      const c = credsRef.current ?? loadCreds(id);
      const data = await api<{ code: string; state: LobbyState }>(`/api/games/${id}?pid=${c?.pid ?? ""}`);
      handleLobbyStateRef.current(data.code, data.state);
    } catch {
      setErr("Lobby not found");
    }
  }, [id]);

  useEffect(() => {
    // Fetch initial lobby state once on mount; all updates are pure WebSockets
    void poll();

    const pusher = getPusherClient();
    if (pusher && id) {
      const channelId = pusher.subscribe(`game-${id.toUpperCase()}`);
      const onUpdate = (data: { code?: string; state?: LobbyState }) => {
        if (data?.state) {
          handleLobbyStateRef.current(data.code ?? codeRef.current, data.state);
        }
      };

      const onDestroyed = (data: { reason?: string }) => {
        clearCreds(id);
        setErr(data?.reason || "This lobby has been closed by the host.");
        setTimeout(() => {
          router.replace("/");
        }, 1500);
      };

      channelId.bind("lobby-updated", onUpdate);
      channelId.bind("game-updated", onUpdate);
      channelId.bind("game-destroyed", onDestroyed);

      let channelCode: ReturnType<typeof pusher.subscribe> | null = null;
      if (code) {
        channelCode = pusher.subscribe(`game-${code.toUpperCase()}`);
        channelCode.bind("lobby-updated", onUpdate);
        channelCode.bind("game-updated", onUpdate);
        channelCode.bind("game-destroyed", onDestroyed);
      }

      return () => {
        channelId.unbind("lobby-updated", onUpdate);
        channelId.unbind("game-updated", onUpdate);
        channelId.unbind("game-destroyed", onDestroyed);
        pusher.unsubscribe(`game-${id.toUpperCase()}`);
        if (channelCode) {
          channelCode.unbind("lobby-updated", onUpdate);
          channelCode.unbind("game-updated", onUpdate);
          channelCode.unbind("game-destroyed", onDestroyed);
          pusher.unsubscribe(`game-${code.toUpperCase()}`);
        }
      };
    }
  }, [poll, id, code, router]);

  const currentCreds = credsRef.current ?? creds;
  const me = state?.players.find((p) => p.you);
  const isHost = Boolean(
    (me && me.id === state?.hostId) ||
    (currentCreds?.pid && state?.hostId && currentCreds.pid === state.hostId)
  );

  const action = async (body: Record<string, unknown>) => {
    const current = credsRef.current ?? creds ?? loadCreds(id);
    if (!current) return;
    try {
      const res = await api<{ ok: boolean; code?: string; state?: LobbyState }>(
        `/api/games/${id}/action`,
        { pid: current.pid, secret: current.secret, ...body }
      );
      if (res?.state) {
        handleLobbyStateRef.current(res.code ?? code, res.state);
      }
    } catch (e) {
      setErr((e as Error).message);
      setTimeout(() => setErr(""), 2500);
    }
  };

  const onDestroyLobby = async () => {
    if (!window.confirm("Are you sure you want to close and delete this lobby? All players will be disconnected and this room deleted from the server.")) return;
    const current = credsRef.current ?? creds ?? loadCreds(id);
    if (!current) return;
    try {
      await api(`/api/games/${id}/action`, { action: "destroy", pid: current.pid, secret: current.secret });
      clearCreds(id);
      router.replace("/");
    } catch (e) {
      setErr((e as Error).message);
      setTimeout(() => setErr(""), 2500);
    }
  };

  const copy = () => {
    void navigator.clipboard?.writeText(code);
    setCopied(true);
    sfx.click();
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[#060b18] p-4">
      <div className="pointer-events-none absolute inset-0">
        <div className="aurora left-[-10%] top-[-20%] bg-emerald-500/20" />
        <div className="aurora right-[-15%] bottom-[-25%] bg-violet-500/15" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 flex w-full max-w-md flex-col items-center gap-5 rounded-3xl border border-white/10 bg-slate-950/80 p-6 shadow-2xl backdrop-blur-xl md:p-8"
      >
        <div className="flex w-full items-center justify-between">
          <h1 className="font-display text-xl font-black tracking-wide text-white">
            SERPENTIA <span className="text-emerald-400">LOBBY</span>
          </h1>
          <div className="flex items-center gap-2">
            {code && me && (
              <VoiceChat
                roomCode={code}
                playerName={me.name}
                playerId={me.id}
                compact
              />
            )}
            <button onClick={() => router.push("/")} className="rounded-xl border border-white/10 bg-white/5 p-2 text-white/70 hover:bg-white/10">
              <Home className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* join code */}
        <div className="flex w-full flex-col items-center gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-4">
          <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-200/80">Share this code</span>
          <button onClick={copy} className="group flex items-center gap-3">
            <span className="font-display text-4xl font-black tracking-[0.3em] text-white md:text-5xl">{code || "····"}</span>
            {copied ? <Check className="h-5 w-5 text-emerald-300" /> : <Copy className="h-5 w-5 text-white/40 transition group-hover:text-white/80" />}
          </button>
          <span className="text-xs text-white/40">Friends join from the main menu</span>
        </div>

        {/* meta */}
        <div className="flex gap-2">
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-bold text-white/70">
            {boardLabel(state?.board, state?.size)}
          </span>
          {state?.mode === "fire" ? (
            <span className="flex items-center gap-1 rounded-full border border-red-400/30 bg-red-500/15 px-3 py-1 text-[11px] font-black text-red-300">
              <Flame className="h-3 w-3" /> FIRE MODE
            </span>
          ) : state?.mode === "hunt" ? (
            <span className="flex items-center gap-1 rounded-full border border-violet-400/30 bg-violet-500/15 px-3 py-1 text-[11px] font-black text-violet-300">
              <Crosshair className="h-3 w-3" /> HUNT MODE
            </span>
          ) : (
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-bold text-white/70">CLASSIC</span>
          )}
        </div>

        {/* players */}
        <div className="w-full space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/40">
            <Users className="h-3.5 w-3.5" /> Players ({state?.players.length ?? 0}/4)
          </div>
          <AnimatePresence>
            {state?.players.map((p) => (
              <motion.div
                key={p.id}
                layout
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className={`flex items-center justify-between rounded-2xl border px-3.5 py-2.5 ${p.you ? "border-emerald-400/40 bg-emerald-400/10" : "border-white/10 bg-white/5"}`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="h-3 w-3 rounded-full" style={{ background: p.color, boxShadow: `0 0 10px ${p.color}` }} />
                  <span className="text-sm font-bold text-white">{p.name}</span>
                  {p.id === state.hostId && <Crown className="h-3.5 w-3.5 text-amber-300" />}
                  {p.isBot && <Bot className="h-3.5 w-3.5 text-cyan-300" />}
                  {p.you && <span className="text-[10px] font-black text-emerald-300">YOU</span>}
                </div>
                {isHost && p.isBot && (
                  <button onClick={() => void action({ action: "removeBot", botId: p.id })} className="rounded-lg p-1.5 text-white/40 hover:bg-rose-500/20 hover:text-rose-300">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
          {(state?.players.length ?? 4) < 4 && !state && null}
        </div>

        {/* actions */}
        {isHost ? (
          <div className="flex w-full flex-col gap-2">
            <motion.button
              whileTap={{ scale: 0.97 }}
              disabled={starting || (state?.players.length ?? 0) < 2}
              onClick={async () => {
                setStarting(true);
                await action({ action: "start" });
                setStarting(false);
              }}
              className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-400 py-3.5 text-sm font-black uppercase tracking-widest text-slate-950 shadow-[0_0_24px_rgba(52,211,153,0.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Play className="h-4 w-4" /> {starting ? "Starting…" : "Start game"}
            </motion.button>
            {(state?.players.length ?? 0) < 4 && (
              <button
                onClick={() => void action({ action: "addBot" })}
                className="flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 py-3 text-sm font-bold text-white/80 transition hover:bg-white/10"
              >
                <Bot className="h-4 w-4" /> Add a bot
              </button>
            )}
            {(state?.players.length ?? 0) < 2 && <p className="text-center text-xs text-white/40">Waiting for players — or add a bot to start</p>}
            <button
              onClick={() => void onDestroyLobby()}
              className="mt-1 flex items-center justify-center gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/10 py-2.5 text-xs font-bold text-rose-300 transition hover:bg-rose-500/20 hover:border-rose-500/40"
            >
              <Trash2 className="h-3.5 w-3.5" /> Close & Delete Lobby
            </button>
          </div>
        ) : (
          <div className="flex w-full flex-col gap-2">
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/60">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
              Waiting for the host to start…
            </div>
            <button
              onClick={async () => {
                await action({ action: "leave" });
                clearCreds(id);
                router.replace("/");
              }}
              className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 py-2 text-xs font-bold text-white/50 transition hover:bg-white/10 hover:text-white/80"
            >
              Leave Lobby
            </button>
          </div>
        )}

        <AnimatePresence>
          {err && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-xs font-semibold text-rose-300">
              {err}
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

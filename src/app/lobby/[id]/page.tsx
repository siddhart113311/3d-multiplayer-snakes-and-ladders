"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Check, Copy, Crosshair, Crown, Flame, Home, Play, Trash2, Users } from "lucide-react";
import { api, loadCreds, PlayerCreds } from "@/lib/api";
import { BoardShape, cellCount, clampSize, DEFAULT_SIZE, sizeLabel } from "@/game/boards";
import { sfx } from "@/game/sounds";
import { getPusherClient } from "@/lib/pusher/client";

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
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    setCreds(loadCreds(id));
  }, [id]);

  const handleLobbyState = useCallback(
    (dataCode: string, st: LobbyState) => {
      setCode(dataCode);
      const c = loadCreds(id);
      const taggedPlayers = st.players.map((p) => ({
        ...p,
        you: p.id === c?.pid,
      }));
      const updatedState = { ...st, players: taggedPlayers };
      setState(updatedState);
      if (updatedState.status === "playing" && updatedState.players.some((p) => p.you)) {
        router.replace(`/game/${id}`);
      }
    },
    [id, router]
  );

  const poll = useCallback(async () => {
    try {
      const c = loadCreds(id);
      const data = await api<{ code: string; state: LobbyState }>(`/api/games/${id}?pid=${c?.pid ?? ""}`);
      handleLobbyState(data.code, data.state);
    } catch {
      setErr("Lobby not found");
    }
  }, [id, handleLobbyState]);

  useEffect(() => {
    void poll();
    // Relaxed fallback poll every 8 seconds
    const iv = setInterval(() => void poll(), 8000);

    const pusher = getPusherClient();
    if (pusher && code) {
      const channel = pusher.subscribe(`game-${code.toUpperCase()}`);
      channel.bind("lobby-updated", (data: { code?: string; state?: LobbyState }) => {
        if (data?.state) {
          handleLobbyState(data.code ?? code, data.state);
        }
      });
      return () => {
        clearInterval(iv);
        channel.unbind("lobby-updated");
        pusher.unsubscribe(`game-${code.toUpperCase()}`);
      };
    }

    return () => clearInterval(iv);
  }, [poll, code, handleLobbyState]);

  const me = state?.players.find((p) => p.you);
  const isHost = me && me.id === state?.hostId;

  const action = async (body: Record<string, unknown>) => {
    if (!creds) return;
    try {
      await api(`/api/games/${id}/action`, { pid: creds.pid, secret: creds.secret, ...body });
      await poll();
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
          <button onClick={() => router.push("/")} className="rounded-xl border border-white/10 bg-white/5 p-2 text-white/70 hover:bg-white/10">
            <Home className="h-4 w-4" />
          </button>
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
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/60">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
            Waiting for the host to start…
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

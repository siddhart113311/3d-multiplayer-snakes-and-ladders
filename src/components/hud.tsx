"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpToLine as LadderIcon, Box, Crown, Flame, Grid2x2, Home, LogOut, Pause, Play, Skull, Swords, Trophy, Volume2, VolumeX } from "lucide-react";
import DiceCube from "./DiceCube";

export interface HudPlayer {
  id: string;
  name: string;
  color: string;
  isBot: boolean;
  pos: number;
  finished: boolean;
  finishOrder: number;
  ladders: number;
  gulped: number;
  you: boolean;
}

export function PlayerTray({
  players,
  turnId,
  last,
  compact = false,
}: {
  players: HudPlayer[];
  turnId: string;
  last: number;
  compact?: boolean;
}) {
  if (compact) {
    // Phones: a single horizontal strip of pills instead of a tall column,
    // so the tray never eats the board area.
    return (
      <div className="pointer-events-none flex max-w-[62vw] flex-wrap gap-1.5">
        {players.map((p) => {
          const active = p.id === turnId;
          return (
            <div
              key={p.id}
              className={`flex items-center gap-1.5 rounded-full border px-2 py-1 backdrop-blur-md ${
                active ? "border-white/40 bg-white/20" : "border-white/10 bg-black/40"
              }`}
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${active ? "animate-pulse" : ""}`}
                style={{ background: p.color, boxShadow: `0 0 8px ${p.color}` }}
              />
              <span className="max-w-[52px] truncate text-[10px] font-bold text-white">{p.name}</span>
              <span className="font-mono text-[10px] text-white/60">{p.pos < 0 ? "–" : p.pos + 1}</span>
              {p.finishOrder === 1 && <Crown className="h-3 w-3 text-amber-300" />}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="pointer-events-none flex flex-col gap-2">
      <AnimatePresence>
        {players.map((p) => {
          const active = p.id === turnId;
          return (
            <motion.div
              key={p.id}
              layout
              initial={{ x: -30, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              className={`flex items-center gap-2.5 rounded-2xl border px-3 py-2 backdrop-blur-md transition-colors duration-300 ${
                active ? "border-white/30 bg-white/15 shadow-[0_0_24px_rgba(255,255,255,0.12)]" : "border-white/10 bg-black/35"
              }`}
            >
              <div
                className={`h-3.5 w-3.5 shrink-0 rounded-full ${active ? "animate-pulse" : ""}`}
                style={{ background: p.color, boxShadow: `0 0 12px ${p.color}` }}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-white">
                    {p.name}
                    {p.you && <span className="ml-1 text-[10px] font-bold text-emerald-300">YOU</span>}
                  </span>
                  {p.isBot && <span className="rounded bg-white/10 px-1 text-[9px] font-bold tracking-wider text-slate-300">BOT</span>}
                  {p.finishOrder === 1 && <Crown className="h-3.5 w-3.5 text-amber-300" />}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-300/90">
                  <span className="font-mono">{p.pos < 0 ? "start" : `${p.pos + 1}/${last + 1}`}</span>
                  {p.ladders > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-amber-300">
                      <LadderIcon className="h-3 w-3" />
                      {p.ladders}
                    </span>
                  )}
                  {p.gulped > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-rose-300">
                      <Skull className="h-3 w-3" />
                      {p.gulped}
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export function FireTimer({
  nextSnakeAt,
  interval,
  compact = false,
}: {
  nextSnakeAt: number;
  interval: number;
  compact?: boolean;
}) {
  const remain = Math.max(0, nextSnakeAt - Date.now());
  const frac = remain / interval;
  const urgent = remain < 4000;
  return (
    <div
      className={`flex items-center backdrop-blur-md ${compact ? "gap-1.5 rounded-xl px-2 py-1" : "gap-2 rounded-2xl px-3 py-2"} border ${
        urgent ? "border-red-400/50 bg-red-500/20" : "border-orange-300/25 bg-black/35"
      }`}
    >
      <Flame className={`${compact ? "h-4 w-4" : "h-5 w-5"} ${urgent ? "animate-bounce text-red-400" : "text-orange-400"}`} />
      {!compact && (
        <div className="flex flex-col">
          <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-orange-200/80">Snakes move</span>
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-[width] duration-200 ${urgent ? "bg-red-500" : "bg-orange-400"}`}
              style={{ width: `${frac * 100}%` }}
            />
          </div>
        </div>
      )}
      <span className={`font-mono font-bold ${compact ? "text-xs" : "text-sm"} ${urgent ? "text-red-300" : "text-orange-200"}`}>
        {Math.ceil(remain / 1000)}s
      </span>
    </div>
  );
}

export function LogTicker({ lines }: { lines: string[] }) {
  const last3 = lines.slice(-3);
  return (
    <div className="pointer-events-none flex max-w-xs flex-col gap-1">
      <AnimatePresence mode="popLayout">
        {last3.map((l, i) => (
          <motion.div
            key={`${l}-${i}-${lines.length}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: i === last3.length - 1 ? 1 : 0.45, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-lg border border-white/10 bg-black/40 px-2.5 py-1 text-[11px] text-slate-200 backdrop-blur-sm"
          >
            {l}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function RollDock({
  dice,
  rolling,
  canRoll,
  reason,
  onRoll,
  compact = false,
}: {
  dice: number;
  rolling: boolean;
  canRoll: boolean;
  reason: string;
  onRoll: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`pointer-events-auto flex items-center rounded-3xl border border-white/15 bg-black/45 backdrop-blur-lg ${
        compact ? "gap-2.5 px-3 py-2.5" : "gap-3 px-4 py-3"
      }`}
    >
      <DiceCube value={dice} rolling={rolling} size={compact ? 44 : 52} />
      <div className="flex flex-col items-start gap-1">
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={onRoll}
          disabled={!canRoll}
          // min-height keeps the tap target >= 44px per mobile a11y guidance
          className={`rounded-2xl font-black uppercase tracking-widest transition-all ${
            compact ? "min-h-[46px] px-7 text-base" : "px-6 py-2.5 text-sm"
          } ${
            canRoll
              ? "bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 shadow-[0_0_28px_rgba(52,211,153,0.45)] hover:shadow-[0_0_40px_rgba(52,211,153,0.7)]"
              : "cursor-not-allowed bg-white/10 text-white/40"
          }`}
        >
          Roll
        </motion.button>
        <span className={`truncate text-[10px] text-white/50 ${compact ? "max-w-[120px]" : "max-w-[150px]"}`}>
          {rolling ? "Rolling the fates…" : reason}
        </span>
      </div>
    </div>
  );
}

export function TopBar({
  code,
  mode,
  muted,
  onMute,
  onPause,
  onHome,
  flatView,
  onToggleView,
  compact = false,
}: {
  code: string;
  mode: string;
  muted: boolean;
  onMute: () => void;
  onPause: () => void;
  onHome: () => void;
  flatView: boolean;
  onToggleView: () => void;
  compact?: boolean;
}) {
  const btn = compact
    ? "rounded-xl border border-white/10 bg-black/45 p-2 text-white/80 backdrop-blur-md active:bg-white/15"
    : "rounded-2xl border border-white/10 bg-black/40 p-2.5 text-white/80 backdrop-blur-md transition hover:bg-white/10";
  const icon = compact ? "h-4 w-4" : "h-4 w-4";
  return (
    <div className="pointer-events-auto flex items-center gap-1.5 md:gap-2">
      <div className="mr-1 hidden items-center gap-2 rounded-2xl border border-white/10 bg-black/40 px-3 py-2 backdrop-blur-md md:flex">
        <Swords className="h-4 w-4 text-emerald-300" />
        <span className="text-xs font-bold tracking-[0.25em] text-white/80">SERPENTIA</span>
        {mode === "fire" && (
          <span className="rounded bg-red-500/25 px-1.5 py-0.5 text-[9px] font-black tracking-widest text-red-300">FIRE</span>
        )}
        <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/60">{code}</span>
      </div>
      <button
        onClick={onToggleView}
        title={flatView ? "Switch to 3D view" : "Switch to 2D top-down view"}
        className={`flex items-center gap-1 font-black tracking-widest backdrop-blur-md transition ${
          compact ? "rounded-xl px-2 py-2 text-[10px]" : "rounded-2xl px-2.5 py-2.5 text-[10px]"
        } border ${
          flatView
            ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-200"
            : "border-white/10 bg-black/40 text-white/80 hover:bg-white/10"
        }`}
      >
        {flatView ? <Grid2x2 className={icon} /> : <Box className={icon} />}
        {flatView ? "2D" : "3D"}
      </button>
      <button onClick={onMute} className={btn} aria-label="Toggle sound">
        {muted ? <VolumeX className={icon} /> : <Volume2 className={icon} />}
      </button>
      <button onClick={onPause} className={btn} aria-label="Pause">
        <Pause className={icon} />
      </button>
      <button onClick={onHome} className={btn} aria-label="Home">
        <Home className={icon} />
      </button>
    </div>
  );
}

export function PauseOverlay({
  onResume,
  onQuit,
  muted,
  onMute,
}: {
  onResume: () => void;
  onQuit: () => void;
  muted: boolean;
  onMute: () => void;
}) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.9, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        className="flex w-72 flex-col gap-3 rounded-3xl border border-white/15 bg-slate-950/90 p-6 shadow-2xl"
      >
        <h2 className="text-center font-display text-2xl font-black tracking-wide text-white">PAUSED</h2>
        <p className="text-center text-xs text-white/50">In online games the board keeps moving!</p>
        <button
          onClick={onResume}
          className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-400 py-3 text-sm font-black uppercase tracking-widest text-slate-950"
        >
          <Play className="h-4 w-4" /> Resume
        </button>
        <button onClick={onMute} className="flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 py-3 text-sm font-bold text-white/80">
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />} {muted ? "Unmute" : "Mute"}
        </button>
        <button onClick={onQuit} className="flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 py-3 text-sm font-bold text-rose-300">
          <LogOut className="h-4 w-4" /> Quit to menu
        </button>
      </motion.div>
    </motion.div>
  );
}

export function GameOverOverlay({
  winnerName,
  winnerColor,
  youWon,
  rows,
  name,
  setName,
  onSave,
  saved,
  onRematch,
  onHome,
  rematchLabel = "Instant Rematch",
  subtitle,
}: {
  winnerName: string;
  winnerColor: string;
  youWon: boolean;
  rows: Array<{ name: string; color: string; score: number; you: boolean }>;
  name: string;
  setName: (v: string) => void;
  onSave: () => void;
  saved: boolean;
  onRematch: () => void;
  onHome: () => void;
  rematchLabel?: string;
  subtitle?: string;
}) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.85, y: 24 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 18 }}
        className="flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl border border-white/15 bg-slate-950/95 p-6 shadow-2xl"
      >
        <motion.div animate={{ rotate: [0, -8, 8, 0] }} transition={{ repeat: Infinity, duration: 2.4 }}>
          <Trophy className="h-12 w-12 text-amber-300 drop-shadow-[0_0_18px_rgba(251,191,36,0.6)]" />
        </motion.div>
        <div className="text-center">
          <h2 className="font-display text-3xl font-black tracking-wide text-white">{youWon ? "VICTORY!" : "GAME OVER"}</h2>
          <p className="mt-1 text-sm text-white/60">
            <span style={{ color: winnerColor }} className="font-bold">
              {winnerName}
            </span>{" "}
            conquers the summit
          </p>
          {subtitle && <p className="mt-1 text-xs font-semibold text-emerald-300/80">{subtitle}</p>}
        </div>

        <div className="w-full space-y-1.5">
          {rows.map((r, i) => (
            <div key={i} className={`flex items-center justify-between rounded-xl border px-3 py-2 ${r.you ? "border-emerald-400/40 bg-emerald-400/10" : "border-white/10 bg-white/5"}`}>
              <span className="flex items-center gap-2 text-sm font-semibold text-white">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />
                {r.name}
              </span>
              <span className="font-mono text-sm font-black text-amber-300">{r.score}</span>
            </div>
          ))}
        </div>

        {!saved ? (
          <div className="flex w-full gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 14))}
              placeholder="Your name"
              className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-400/60"
            />
            <button onClick={onSave} className="rounded-xl bg-amber-400 px-4 text-sm font-black uppercase text-slate-950 transition hover:bg-amber-300">
              Save
            </button>
          </div>
        ) : (
          <p className="text-xs font-bold text-emerald-300">Score saved to the hall of fame!</p>
        )}

        <div className="flex w-full gap-2">
          <button
            onClick={onRematch}
            className="flex-1 rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-400 py-3 text-sm font-black uppercase tracking-widest text-slate-950 transition hover:brightness-110"
          >
            {rematchLabel}
          </button>
          <button onClick={onHome} className="rounded-2xl border border-white/15 bg-white/5 px-4 text-sm font-bold text-white/80">
            Menu
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { motion } from "framer-motion";
import { Bot, Crown, Flame, Gamepad2, Hexagon, Play, Pyramid, Sparkles, Square, Swords, Trophy, User, Users, Volume2, VolumeX, Wifi } from "lucide-react";
import { BoardShape, BoardSize, cellCount, DEFAULT_SIZE, MAX_CELLS, sizeLabel } from "@/game/boards";
import { DIFFICULTY_LABEL, type Difficulty } from "@/game/localGame";
import { sfx } from "@/game/sounds";
import { api, loadLocalScores, saveCreds } from "@/lib/api";

const BOARDS: Array<{ shape: BoardShape; name: string; icon: typeof Square; blurb: string }> = [
  { shape: "square", name: "Classic Square", icon: Square, blurb: "The timeless boustrophedon grid" },
  { shape: "hex", name: "Hive Spiral", icon: Hexagon, blurb: "A spiralling honeycomb gauntlet" },
  { shape: "triangle", name: "Prism Peak", icon: Pyramid, blurb: "Ascend a razor-edged summit" },
];

/** Flavour text for each of the 10 size steps. */
const SIZE_TIERS = ["Skirmish", "Skirmish", "Short", "Short", "Standard", "Standard", "Long", "Long", "Epic", "Epic"];

interface ScoreRow {
  id?: number;
  name: string;
  score: number;
  mode: string;
  board: string;
  won?: boolean;
}

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [board, setBoard] = useState<BoardShape>("square");
  const [size, setSize] = useState<BoardSize>(DEFAULT_SIZE);
  const [mode, setMode] = useState<"classic" | "fire">("classic");
  const cells = cellCount(board, size);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<"solo" | "online">("solo");
  const [opponents, setOpponents] = useState(2);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [muted, setMuted] = useState(false);
  const [top, setTop] = useState<ScoreRow[]>([]);
  const [mine, setMine] = useState<ScoreRow[]>([]);

  useEffect(() => {
    setMuted(sfx.muted);
    setName(window.localStorage.getItem("serp_name") ?? "");
    setMine(loadLocalScores().map((s) => ({ name: s.name, score: s.score, mode: s.mode, board: s.board })));
    void api<{ scores: ScoreRow[] }>("/api/scores")
      .then((d) => setTop(d.scores))
      .catch(() => {});
  }, []);

  const startSolo = () => {
    sfx.unlock();
    sfx.click();
    const playerName = (name || "You").trim().slice(0, 14);
    window.localStorage.setItem("serp_name", playerName);
    setBusy("solo");
    // fresh run id every time → a brand new snake/ladder layout each start
    const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const q = new URLSearchParams({ board, size: String(size), mode, ops: String(opponents), diff: difficulty, name: playerName, run: runId });
    router.push(`/solo?${q.toString()}`);
  };

  const go = async (kind: "create" | "quick" | "join") => {
    sfx.unlock();
    sfx.click();
    setErr("");
    const playerName = (name || "Player").trim().slice(0, 14);
    window.localStorage.setItem("serp_name", playerName);
    setBusy(kind);
    try {
      if (kind === "join") {
        const data = await api<{ gameId: string; playerId: string; secret: string }>("/api/games/join", { code: code.trim().toUpperCase(), name: playerName });
        saveCreds(data.gameId, { pid: data.playerId, secret: data.secret, name: playerName });
        router.push(`/lobby/${data.gameId}`);
      } else {
        const data = await api<{ gameId: string; playerId: string; secret: string; status: string }>("/api/games", {
          name: playerName,
          board,
          size,
          mode,
          quick: kind === "quick",
          bots: 3,
        });
        saveCreds(data.gameId, { pid: data.playerId, secret: data.secret, name: playerName });
        router.push(kind === "quick" ? `/game/${data.gameId}` : `/lobby/${data.gameId}`);
      }
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-[#060b18] text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="aurora left-[-10%] top-[-25%] bg-emerald-500/25" />
        <div className="aurora right-[-20%] bottom-[-30%] bg-violet-600/20" />
        <div className="aurora left-[30%] bottom-[-35%] bg-cyan-500/15" />
      </div>

      {/* header */}
      <header className="relative z-10 flex items-center justify-between px-5 pt-5 md:px-10">
        <div className="flex items-center gap-2">
          <Gamepad2 className="h-5 w-5 text-emerald-300" />
          <span className="text-xs font-black tracking-[0.35em] text-white/70">SERPENTIA · 3D</span>
        </div>
        <button
          onClick={() => setMuted(sfx.toggleMute())}
          className="rounded-xl border border-white/10 bg-white/5 p-2.5 text-white/70 backdrop-blur-md transition hover:bg-white/10"
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
      </header>

      <main className="relative z-10 mx-auto grid max-w-6xl gap-8 px-5 pb-16 pt-8 md:px-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-10">
        {/* left: hero + 3d preview */}
        <div className="flex flex-col gap-6">
          <div>
            <motion.h1
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              className="font-display text-5xl font-black leading-[0.95] tracking-tight md:text-7xl"
            >
              <span className="bg-gradient-to-r from-emerald-300 via-cyan-200 to-emerald-400 bg-clip-text text-transparent">SNAKES</span>
              <br />
              <span className="text-white">
                &amp; <span className="bg-gradient-to-r from-amber-300 to-orange-400 bg-clip-text text-transparent">LADDERS</span>
              </span>
            </motion.h1>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="mt-3 max-w-md text-sm leading-relaxed text-white/60 md:text-base">
              The classic race, reborn in glorious 3D. Serpents breathe, jaws snap, and in{" "}
              <span className="font-bold text-red-400">Fire&nbsp;Mode</span> hungry snakes roam the board and gulp down anyone in their path.
            </motion.p>
          </div>

          {/* hero key art */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="group relative h-64 overflow-hidden rounded-3xl border border-white/10 bg-black/30 shadow-[0_20px_80px_rgba(0,0,0,0.5)] md:h-80"
          >
            <Image
              src="/images/hero-board.jpg"
              alt="A giant scaled serpent looming over a glowing 3D snakes and ladders board"
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 640px"
              className="object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.06]"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#060b18] via-transparent to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-4">
              <div>
                <span className="block text-[10px] font-black uppercase tracking-[0.3em] text-emerald-300/90">
                  {BOARDS.find((b) => b.shape === board)?.name}
                </span>
                <span className="block text-[10px] font-bold uppercase tracking-[0.25em] text-white/45">
                  {cells} squares · {sizeLabel(board, size)} ·{" "}
                  {mode === "fire" ? "roaming serpents" : "classic rules"}
                </span>
              </div>
              <span className="rounded-full border border-white/15 bg-black/50 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.25em] text-white/60 backdrop-blur-sm">
                3D · Online
              </span>
            </div>
          </motion.div>

          {/* hall of fame */}
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-md">
            <div className="mb-3 flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-300" />
              <h2 className="text-xs font-black uppercase tracking-[0.3em] text-white/70">Hall of Fame</h2>
            </div>
            <div className="grid gap-1.5 md:grid-cols-2">
              {(top.length ? top : mine).slice(0, 6).map((s, i) => (
                <div key={i} className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-black/30 px-3 py-2">
                  <span className="flex items-center gap-2 text-sm font-semibold text-white/85">
                    {i === 0 && <Crown className="h-3.5 w-3.5 text-amber-300" />}
                    <span className="max-w-[110px] truncate">{s.name}</span>
                    {s.mode === "fire" && <Flame className="h-3 w-3 text-red-400" />}
                  </span>
                  <span className="font-mono text-sm font-black text-amber-300">{s.score}</span>
                </div>
              ))}
              {top.length === 0 && mine.length === 0 && (
                <p className="col-span-2 py-2 text-center text-xs text-white/40">No legends yet — be the first to conquer the summit.</p>
              )}
            </div>
          </div>
        </div>

        {/* right: menu */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex h-fit flex-col gap-5 rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-2xl backdrop-blur-xl"
        >
          <div>
            <label className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.3em] text-white/50">Your name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 14))}
              placeholder="Player"
              className="w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white outline-none transition focus:border-emerald-400/60 focus:bg-white/[0.08]"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.3em] text-white/50">Board shape</label>
            <div className="grid grid-cols-3 gap-2">
              {BOARDS.map((b) => {
                const Icon = b.icon;
                const active = board === b.shape;
                return (
                  <button
                    key={b.shape}
                    onClick={() => {
                      setBoard(b.shape);
                      sfx.click();
                    }}
                    className={`group flex flex-col items-center gap-1.5 rounded-2xl border p-3 transition-all ${
                      active
                        ? "border-emerald-400/60 bg-emerald-400/15 shadow-[0_0_20px_rgba(52,211,153,0.25)]"
                        : "border-white/10 bg-white/5 hover:border-white/25"
                    }`}
                  >
                    <Icon className={`h-6 w-6 ${active ? "text-emerald-300" : "text-white/50 group-hover:text-white/80"}`} />
                    <span className={`text-[10px] font-black ${active ? "text-white" : "text-white/50"}`}>{b.name.split(" ")[1] ?? b.name}</span>
                    <span className="text-[9px] text-white/35">{cellCount(b.shape, size)} cells</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-white/40">{BOARDS.find((b) => b.shape === board)?.blurb}</p>
          </div>

          {/* board size — 10 steps, identical scale for every shape */}
          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <label className="text-[10px] font-black uppercase tracking-[0.3em] text-white/50">Board size</label>
              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-300/80">
                {SIZE_TIERS[size]} · {sizeLabel(board, size)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={9}
              step={1}
              value={size}
              onChange={(e) => {
                setSize(Number(e.target.value) as BoardSize);
                sfx.click();
              }}
              aria-label="Board size"
              className="serp-range w-full"
            />
            <div className="mt-1 flex items-center justify-between text-[10px] font-bold text-white/35">
              <span>{cellCount(board, 0)} cells</span>
              <span className="font-mono text-sm font-black text-white">
                {cells}
                <span className="ml-1 text-[9px] font-bold uppercase tracking-widest text-white/40">cells</span>
              </span>
              <span>max {MAX_CELLS}</span>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.3em] text-white/50">Mode</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setMode("classic");
                  sfx.click();
                }}
                className={`flex items-center justify-center gap-2 rounded-2xl border py-3 text-xs font-black uppercase tracking-wider transition-all ${
                  mode === "classic" ? "border-cyan-400/60 bg-cyan-400/15 text-white shadow-[0_0_18px_rgba(34,211,238,0.25)]" : "border-white/10 bg-white/5 text-white/50"
                }`}
              >
                <Sparkles className="h-4 w-4" /> Classic
              </button>
              <button
                onClick={() => {
                  setMode("fire");
                  sfx.click();
                }}
                className={`flex items-center justify-center gap-2 rounded-2xl border py-3 text-xs font-black uppercase tracking-wider transition-all ${
                  mode === "fire" ? "border-red-400/60 bg-red-500/15 text-white shadow-[0_0_18px_rgba(248,113,113,0.3)]" : "border-white/10 bg-white/5 text-white/50"
                }`}
              >
                <Flame className="h-4 w-4" /> Fire
              </button>
            </div>
            {mode === "fire" && <p className="mt-1.5 text-[11px] font-semibold text-red-300/80">Snakes migrate every 18 seconds — gulp anyone in their path!</p>}
          </div>

          {/* solo / online switch */}
          <div className="grid grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-black/40 p-1">
            {(["solo", "online"] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  sfx.click();
                }}
                className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[11px] font-black uppercase tracking-widest transition-all ${
                  tab === t ? "bg-white/15 text-white shadow-inner" : "text-white/40 hover:text-white/70"
                }`}
              >
                {t === "solo" ? <User className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}
                {t === "solo" ? "Single player" : "Multiplayer"}
              </button>
            ))}
          </div>

          {tab === "solo" ? (
            <div className="flex flex-col gap-4">
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.3em] text-white/50">Opponents</label>
                <div className="grid grid-cols-4 gap-2">
                  {[0, 1, 2, 3].map((n) => (
                    <button
                      key={n}
                      onClick={() => {
                        setOpponents(n);
                        sfx.click();
                      }}
                      className={`flex flex-col items-center gap-0.5 rounded-2xl border py-2.5 transition-all ${
                        opponents === n ? "border-emerald-400/60 bg-emerald-400/15 text-white" : "border-white/10 bg-white/5 text-white/45 hover:border-white/25"
                      }`}
                    >
                      <span className="text-base font-black">{n === 0 ? "—" : n}</span>
                      <span className="text-[8px] font-bold uppercase tracking-wider">{n === 0 ? "Solo" : n === 1 ? "Bot" : "Bots"}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-white/40">
                  {opponents === 0 ? "Time attack — race the clock to the summit alone" : `Face ${opponents} AI rival${opponents > 1 ? "s" : ""}`}
                </p>
              </div>

              {opponents > 0 && (
                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.3em] text-white/50">AI difficulty</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(Object.keys(DIFFICULTY_LABEL) as Difficulty[]).map((d) => (
                      <button
                        key={d}
                        onClick={() => {
                          setDifficulty(d);
                          sfx.click();
                        }}
                        className={`flex items-center justify-center gap-1.5 rounded-2xl border py-2.5 text-[11px] font-black uppercase tracking-wider transition-all ${
                          difficulty === d
                            ? "border-violet-400/60 bg-violet-500/15 text-white shadow-[0_0_18px_rgba(167,139,250,0.25)]"
                            : "border-white/10 bg-white/5 text-white/45 hover:border-white/25"
                        }`}
                      >
                        <Bot className="h-3.5 w-3.5" /> {DIFFICULTY_LABEL[d]}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <motion.button
                whileTap={{ scale: 0.97 }}
                disabled={busy !== null}
                onClick={startSolo}
                className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-400 py-3.5 text-sm font-black uppercase tracking-widest text-slate-950 shadow-[0_0_30px_rgba(52,211,153,0.35)] transition hover:brightness-110 disabled:opacity-50"
              >
                <Swords className="h-4 w-4" /> {busy === "solo" ? "Dealing board…" : "Start run"}
              </motion.button>
              <p className="-mt-2 text-center text-[10px] font-bold uppercase tracking-wider text-emerald-300/60">
                Runs offline · zero latency · instant rolls
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              <motion.button
                whileTap={{ scale: 0.97 }}
                disabled={busy !== null}
                onClick={() => void go("create")}
                className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-violet-400 py-3.5 text-sm font-black uppercase tracking-widest text-slate-950 shadow-[0_0_30px_rgba(34,211,238,0.3)] transition hover:brightness-110 disabled:opacity-50"
              >
                <Play className="h-4 w-4" /> {busy === "create" ? "Creating…" : "Create lobby"}
              </motion.button>
              <button
                disabled={busy !== null}
                onClick={() => void go("quick")}
                className="flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 py-3 text-xs font-black uppercase tracking-wider text-white transition hover:bg-white/10 disabled:opacity-50"
              >
                <Users className="h-4 w-4" /> {busy === "quick" ? "…" : "Quick online match vs bots"}
              </button>

              <div className="mt-1 flex items-center gap-2">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-[9px] font-black uppercase tracking-[0.3em] text-white/30">or join</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              <div className="flex gap-2">
                <input
                  id="join-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
                  onKeyDown={(e) => e.key === "Enter" && code.length >= 4 && void go("join")}
                  placeholder="ENTER CODE"
                  className="min-w-0 flex-1 rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-center font-mono text-lg font-black tracking-[0.4em] text-white outline-none transition focus:border-cyan-400/60"
                />
                <button
                  disabled={busy !== null || code.length < 4}
                  onClick={() => void go("join")}
                  className="rounded-2xl bg-gradient-to-r from-cyan-400 to-violet-400 px-5 text-xs font-black uppercase tracking-wider text-slate-950 transition hover:brightness-110 disabled:opacity-40"
                >
                  {busy === "join" ? "…" : "Join"}
                </button>
              </div>
            </div>
          )}

          {err && <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-300">{err}</p>}

          <p className="text-center text-[10px] leading-relaxed text-white/30">
            SPACE / tap to roll · Arrows orbit · V 2D/3D · T chat · P pause · M mute
          </p>
        </motion.div>
      </main>
    </div>
  );
}

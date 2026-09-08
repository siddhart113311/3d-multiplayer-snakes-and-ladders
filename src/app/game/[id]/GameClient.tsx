"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import * as THREE from "three";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Trash2, Users } from "lucide-react";
import { BoardDef, BoardSize, clampSize, DEFAULT_SIZE, getBoard } from "@/game/boards";
import { GameEvent } from "@/game/engine";
import { LocalGame, SoloConfig } from "@/game/localGame";
import { Bridge, Director, SnakeVisual, TokenVisual } from "@/game/director";
import { buildSnakeCurve } from "@/game/snakeCurves";
import { sfx } from "@/game/sounds";
import { api, clearCreds, loadCreds, PlayerCreds, saveCreds, saveLocalScore } from "@/lib/api";
import { useViewport } from "@/lib/useViewport";
import { FireTimer, GameOverOverlay, HudPlayer, HuntTimer, LogTicker, PauseOverlay, PlayerTray, RollDock, TopBar } from "@/components/hud";
import ChatDock, { type ChatMsg } from "@/components/ChatDock";
import type { ParticlesHandle } from "@/components/three/Particles";
import { getPusherClient } from "@/lib/pusher/client";

const Scene = dynamic(() => import("@/components/three/Scene"), { ssr: false });
const VoiceChat = dynamic(() => import("@/components/VoiceChat"), { ssr: false });

interface PubPlayer extends HudPlayer {}
interface PubEvent {
  seq: number;
  type: string;
  [k: string]: unknown;
}
interface PubState {
  board: "square" | "hex" | "triangle";
  size: BoardSize;
  mode: "classic" | "fire" | "hunt";
  status: "waiting" | "playing" | "finished";
  startedAt: number | null;
  hostId: string;
  players: PubPlayer[];
  turn: number;
  dice: number;
  snakes: Array<{ id: number; head: number; tail: number }>;
  ladders: Array<{ bottom: number; top: number }>;
  winner: string | null;
  events: PubEvent[];
  seq: number;
  log: string[];
  chat: ChatMsg[];
  moveCount: number;
  fireIntervalMs: number;
  nextSnakeAt: number;
  huntIntervalMs: number;
  nextCreepAt: number;
  lastActionAt: number;
  scores: Record<string, number>;
}

interface FetchResp {
  gameId: string;
  code: string;
  state: PubState;
  serverNow: number;
}

export default function GameClient({ gameId, solo }: { gameId?: string; solo?: SoloConfig }) {
  const router = useRouter();
  const vp = useViewport();
  const [pub, setPub] = useState<PubState | null>(null);
  const [code, setCode] = useState("");
  const [creds, setCreds] = useState<PlayerCreds | null>(null);
  const [rolling, setRolling] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(Date.now());
  const [joinName, setJoinName] = useState("");
  const [busy, setBusy] = useState(false);
  const [scoreName, setScoreName] = useState("");
  const [saved, setSaved] = useState(false);
  const [flatView, setFlatView] = useState(false);
  // true while the Director still has queued choreography to play out
  const [animating, setAnimating] = useState(false);
  const [speakingPlayerIds, setSpeakingPlayerIds] = useState<string[]>([]);
  const [terminatedReason, setTerminatedReason] = useState<string | null>(null);

  const bridgeRef = useRef<Bridge | null>(null);
  const directorRef = useRef<Director | null>(null);
  const defRef = useRef<BoardDef | null>(null);
  const lastSeqRef = useRef(0);
  const snakeSigRef = useRef("");
  const lastBotRollRef = useRef(0);
  const pausedRef = useRef(false);
  const credsRef = useRef<PlayerCreds | null>(null);
  const rotateSignal = useRef({ az: 0, pol: 0 });
  const savedRef = useRef(false);
  const pubRef = useRef<PubState | null>(null);
  const localRef = useRef<LocalGame | null>(null);

  // Single player boots the engine locally — identical rules, zero network hops.
  if (solo && !localRef.current) localRef.current = LocalGame.create(solo);
  const isSolo = Boolean(solo);
  const storageKey = gameId ?? "solo";

  /** One call shape for both transports (HTTP routes / in-browser engine). */
  const request = useCallback(
    async (kind: "get" | "roll" | "rematch" | "newRun", pid: string, secret: string): Promise<FetchResp> => {
      const lg = localRef.current;
      if (lg) return lg.request(kind, pid) as unknown as FetchResp;
      if (kind === "get") return api<FetchResp>(`/api/games/${gameId}?pid=${pid}`);
      const action = kind === "newRun" ? "rematch" : kind;
      return api<FetchResp>(`/api/games/${gameId}/action`, { action, pid, secret });
    },
    [gameId]
  );

  pausedRef.current = paused;
  credsRef.current = creds;
  pubRef.current = pub;

  const syncSnakes = useCallback((state: PubState, force = false) => {
    const bridge = bridgeRef.current;
    const director = directorRef.current;
    if (!bridge || !defRef.current) return;
    const sig = JSON.stringify(state.snakes);
    if (!force && (sig === snakeSigRef.current || director?.busy)) return;
    snakeSigRef.current = sig;
    for (const s of state.snakes) {
      let v = bridge.snakes.get(s.id);
      if (!v) {
        v = { curve: buildSnakeCurve(defRef.current, s).curve, version: 0, mouth: 0, bulge: { t: 0, active: false, amp: 0 } };
        bridge.snakes.set(s.id, v);
      } else {
        v.curve = buildSnakeCurve(defRef.current, s).curve;
        v.version += 1;
        v.mouth = 0;
        v.bulge = { t: 0, active: false, amp: 0 };
      }
    }
  }, []);

  const processState = useCallback(
    (data: FetchResp) => {
      const state = data.state;
      // drop stale frames (a slow poll may return older state than our roll response)
      if (bridgeRef.current && pubRef.current && state.seq < pubRef.current.seq) return;
      // chat doesn't bump seq, so never let an in-flight poll erase newer messages
      if (pubRef.current && (state.chat?.length ?? 0) < pubRef.current.chat.length) {
        state.chat = pubRef.current.chat;
      }
      const myPid = credsRef.current?.pid;
      if (myPid && state.players) {
        state.players = state.players.map((p) => ({
          ...p,
          you: p.id === myPid,
        }));
      }
      setCode(data.code);
      if (!bridgeRef.current) {
        const def = getBoard(state.board, clampSize(state.size ?? DEFAULT_SIZE));
        defRef.current = def;
        const bridge: Bridge = {
          def,
          tokens: new Map<string, TokenVisual>(),
          snakes: new Map<number, SnakeVisual>(),
          shake: { amp: 0 },
          burst: null,
          onWin: (pid) => {
            void import("canvas-confetti").then(({ default: confetti }) => {
              const me = pubRef.current?.players.find((p) => p.id === pid);
              confetti({ particleCount: 140, spread: 75, origin: { y: 0.7 }, colors: ["#fbbf24", me?.color ?? "#22c55e", "#38bdf8", "#ffffff"] });
              confetti({ particleCount: 60, angle: 60, spread: 60, origin: { x: 0, y: 0.8 } });
              confetti({ particleCount: 60, angle: 120, spread: 60, origin: { x: 1, y: 0.8 } });
            });
          },
          onIdle: () => {
            const st = pubRef.current;
            if (st) {
              const d = directorRef.current;
              if (d?.needsResync) {
                d.needsResync = false;
                snakeSigRef.current = "";
                syncSnakes(st, true);
              }
              d?.snap(st.players);
              syncSnakes(st);
            }
            setBusy(false);
          },
        };
        bridgeRef.current = bridge;
        directorRef.current = new Director(bridge);
        // ensure token visuals exist for all players
        for (const p of state.players) {
          if (!bridge.tokens.has(p.id)) {
            bridge.tokens.set(p.id, { x: def.start.x, y: 0.04, z: def.start.z, scale: 1, squash: 1, visible: true, bobSeed: Math.random() * 10 });
          }
        }
        directorRef.current.snap(state.players);
        snakeSigRef.current = "";
        syncSnakes(state, true);
        lastSeqRef.current = state.seq;
      } else {
        const fresh = state.events.filter((e) => e.seq > lastSeqRef.current);
        if (fresh.length) {
          lastSeqRef.current = Math.max(...fresh.map((e) => e.seq));
          directorRef.current?.enqueue(fresh as unknown as GameEvent[], state.players.map((p) => ({ id: p.id, color: p.color })));
          setBusy(true);
        }
        // NB: snake visuals are only rebuilt when the director is idle (onIdle),
        // so a snakeShift animation always reads its true "from" curve.
      }
      pubRef.current = state;
      setPub(state);
    },
    [syncSnakes]
  );

  const processStateRef = useRef(processState);
  processStateRef.current = processState;

  const fetchState = useCallback(async () => {
    try {
      const pid = credsRef.current?.pid ?? "";
      processStateRef.current(await request("get", pid, credsRef.current?.secret ?? ""));
    } catch (e) {
      const msg = (e as Error).message || "";
      if (msg.includes("not found") && !localRef.current) {
        clearCreds(storageKey);
        setTerminatedReason("This game has been terminated or no longer exists.");
      } else {
        console.warn(e);
      }
    }
  }, [request, storageKey]);

  // init
  useEffect(() => {
    setMuted(sfx.muted);
    try {
      if (window.localStorage.getItem("serp_view") === "2d") setFlatView(true);
    } catch {}
    const lg = localRef.current;
    if (lg) {
      credsRef.current = lg.creds;
      setCreds(lg.creds);
    } else {
      let c: PlayerCreds | null = null;
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        const qPid = params.get("pid");
        const qSecret = params.get("secret");
        const qName = params.get("name") || "Player";
        if (qPid && qSecret) {
          c = { pid: qPid, secret: qSecret, name: qName };
          saveCreds(storageKey, c);
        }
      }
      if (!c) {
        c = loadCreds(storageKey);
      }
      if (c) {
        credsRef.current = c;
        setCreds(c);
      }
    }
    void fetchState();
    // Solo mode ticks locally (400ms); online multiplayer has a 1500ms sync heartbeat alongside WebSockets
    const iv = setInterval(() => void fetchState(), localRef.current ? 400 : 1500);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Real-time Pusher WebSockets updates for online multiplayer (gameId channel)
  useEffect(() => {
    if (localRef.current || !gameId) return;

    const pusher = getPusherClient();
    if (!pusher) return;

    const onGameUpdated = (data: FetchResp) => {
      if (data?.state) {
        processStateRef.current(data);
      }
    };

    const onGameDestroyed = (data: { reason?: string }) => {
      clearCreds(gameId);
      setTerminatedReason(data?.reason || "The host has terminated and deleted this game.");
    };

    const idUpper = `game-${gameId.toUpperCase()}`;
    const idLower = `game-${gameId.toLowerCase()}`;
    const chUpper = pusher.subscribe(idUpper);
    const chLower = idUpper !== idLower ? pusher.subscribe(idLower) : null;

    chUpper.bind("game-updated", onGameUpdated);
    chUpper.bind("game-destroyed", onGameDestroyed);

    if (chLower) {
      chLower.bind("game-updated", onGameUpdated);
      chLower.bind("game-destroyed", onGameDestroyed);
    }

    return () => {
      chUpper.unbind("game-updated", onGameUpdated);
      chUpper.unbind("game-destroyed", onGameDestroyed);
      pusher.unsubscribe(idUpper);
      if (chLower) {
        chLower.unbind("game-updated", onGameUpdated);
        chLower.unbind("game-destroyed", onGameDestroyed);
        pusher.unsubscribe(idLower);
      }
    };
  }, [gameId]);

  // Secondary: Pusher channel for room code (if known)
  useEffect(() => {
    if (localRef.current || !code || !gameId) return;

    const pusher = getPusherClient();
    if (!pusher) return;

    const onGameUpdated = (data: FetchResp) => {
      if (data?.state) {
        processStateRef.current(data);
      }
    };

    const onGameDestroyed = (data: { reason?: string }) => {
      clearCreds(gameId);
      setTerminatedReason(data?.reason || "The host has terminated and deleted this game.");
    };

    const codeChan = `game-${code.toUpperCase()}`;
    const ch = pusher.subscribe(codeChan);
    ch.bind("game-updated", onGameUpdated);
    ch.bind("game-destroyed", onGameDestroyed);

    return () => {
      ch.unbind("game-updated", onGameUpdated);
      ch.unbind("game-destroyed", onGameDestroyed);
      pusher.unsubscribe(codeChan);
    };
  }, [code, gameId]);

  // director ticker — also publishes "is the board still animating?" so the
  // game-over screen can wait for the winning move to finish playing.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let wasBusy = false;
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const d = directorRef.current;
      d?.tick(dt);
      const busyNow = Boolean(d?.busy);
      if (busyNow !== wasBusy) {
        wasBusy = busyNow;
        setAnimating(busyNow);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // hazard countdown ticker — hunt ticks every ~2.6s, so it needs finer updates
  useEffect(() => {
    const period = pub?.mode === "hunt" ? 100 : 300;
    const iv = setInterval(() => setNow(Date.now()), period);
    return () => clearInterval(iv);
  }, [pub?.mode]);

  const me = useMemo(() => pub?.players.find((p) => p.you) ?? null, [pub]);
  const current = pub ? pub.players[pub.turn] : null;
  const isHost = Boolean(me && pub && me.id === pub.hostId);

  const onDestroyGame = useCallback(async () => {
    if (!window.confirm("Are you sure you want to terminate and delete this game? All players will be disconnected, the voice room will close, and this game will be permanently deleted from the database.")) return;
    const c = credsRef.current;
    if (!c || !gameId) return;
    try {
      await api(`/api/games/${gameId}/action`, { action: "destroy", pid: c.pid, secret: c.secret });
      clearCreds(gameId);
      router.push("/");
    } catch (e) {
      setErr((e as Error).message);
      setTimeout(() => setErr(""), 2500);
    }
  }, [gameId, router]);

  const onLeaveGame = useCallback(async () => {
    const c = credsRef.current;
    if (c && gameId && !isSolo) {
      if (isHost) {
        if (!window.confirm("Leaving as host will terminate the game for all players. Are you sure you want to quit?")) return;
        await api(`/api/games/${gameId}/action`, { action: "destroy", pid: c.pid, secret: c.secret }).catch(() => {});
      } else {
        if (!window.confirm("Are you sure you want to leave? A CPU player will take over your spot.")) return;
        await api(`/api/games/${gameId}/action`, { action: "leave", pid: c.pid, secret: c.secret }).catch(() => {});
      }
      clearCreds(gameId);
    }
    router.push("/");
  }, [gameId, isSolo, isHost, router]);

  // If user closes tab or navigates away, inform the server immediately via beacon
  useEffect(() => {
    if (isSolo || !gameId) return;
    const handleBeforeUnload = () => {
      const c = credsRef.current;
      if (!c) return;
      const action = isHost ? "destroy" : "leave";
      const payload = JSON.stringify({ action, pid: c.pid, secret: c.secret });
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon?.(`/api/games/${gameId}/action`, blob);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isSolo, gameId, isHost]);

  const doRoll = useCallback(async () => {
    const c = credsRef.current;
    const st = pubRef.current;
    if (!c || !st || st.status !== "playing" || pausedRef.current) return;
    const cur = st.players[st.turn];
    if (!cur || cur.id !== c.pid) return;
    sfx.unlock();
    setRolling(true);
    try {
      processState(await request("roll", c.pid, c.secret));
    } catch (e) {
      setErr((e as Error).message);
      setTimeout(() => setErr(""), 2500);
    } finally {
      setTimeout(() => setRolling(false), 650);
    }
  }, [request, processState]);

  // Bot driver: a persistent interval that reads ONLY refs. It never re-subscribes
  // on poll updates, so nothing can ever cancel a pending CPU turn. The host (or
  // the solo player) rolls for bots; if the host stalls >9s, any other human may
  // drive so a disconnected host can't freeze the game.
  useEffect(() => {
    const iv = setInterval(() => {
      const st = pubRef.current;
      const c = credsRef.current;
      if (!st || !c || st.status !== "playing" || pausedRef.current) return;
      const cur = st.players[st.turn];
      if (!cur || !cur.isBot) return;
      const meNow = st.players.find((p) => p.id === c.pid);
      if (!meNow || meNow.finished) return;
      const humans = st.players.filter((p) => !p.isBot);
      const hostStalled = st.lastActionAt > 0 && Date.now() - st.lastActionAt > 9000;
      const iDrive = meNow.id === st.hostId || humans.length <= 1 || hostStalled;
      if (!iDrive) return;
      // let the previous choreography finish so turns stay readable
      if (directorRef.current?.busy) return;
      const nowMs = Date.now();
      if (nowMs - lastBotRollRef.current < 1300) return;
      lastBotRollRef.current = nowMs;
      void request("roll", meNow.id, c.secret)
        .then(processState)
        .catch(() => {
          /* next tick retries */
        });
    }, 450);
    return () => clearInterval(iv);
  }, [request, processState]);

  const toggleView = useCallback(() => {
    sfx.click();
    setFlatView((v) => {
      const next = !v;
      try {
        window.localStorage.setItem("serp_view", next ? "2d" : "3d");
      } catch {}
      return next;
    });
  }, []);

  // keyboard controls
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // never hijack keys while the player is typing a taunt
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        void doRoll();
      } else if (e.code === "KeyP") setPaused((p) => !p);
      else if (e.code === "KeyV") toggleView();
      else if (e.code === "KeyM") setMuted(sfx.toggleMute());
      else if (e.code === "ArrowLeft") rotateSignal.current.az = -1;
      else if (e.code === "ArrowRight") rotateSignal.current.az = 1;
      else if (e.code === "ArrowUp") rotateSignal.current.pol = -1;
      else if (e.code === "ArrowDown") rotateSignal.current.pol = 1;
    };
    const up = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "ArrowLeft" || e.code === "ArrowRight") rotateSignal.current.az = 0;
      if (e.code === "ArrowUp" || e.code === "ArrowDown") rotateSignal.current.pol = 0;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [doRoll, toggleView]);

  const joinGame = async () => {
    if (!code || !joinName.trim()) return;
    try {
      const data = await api<{ gameId: string; playerId: string; secret: string }>(`/api/games/join`, {
        code,
        name: joinName.trim(),
      });
      const c = { pid: data.playerId, secret: data.secret, name: joinName.trim() };
      saveCreds(storageKey, c);
      setCreds(c);
      router.replace(`/lobby/${gameId}`);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const sendChat = useCallback(
    async (text: string) => {
      const c = credsRef.current;
      if (!c) return;
      const lg = localRef.current;
      try {
        if (lg) {
          processState(lg.say(c.pid, text) as unknown as FetchResp);
        } else {
          processState(await api<FetchResp>(`/api/games/${gameId}/chat`, { pid: c.pid, secret: c.secret, text }));
        }
      } catch (e) {
        setErr((e as Error).message);
        setTimeout(() => setErr(""), 2000);
      }
    },
    [gameId, processState]
  );

  /** Rematch online; in solo this deals a brand new board for the next run. */
  const rematch = async () => {
    const c = credsRef.current;
    if (!c) return;
    try {
      const data = await request(isSolo ? "newRun" : "rematch", c.pid, c.secret);
      const lg = localRef.current;
      if (lg) {
        credsRef.current = lg.creds;
        setCreds(lg.creds);
      }
      savedRef.current = false;
      setSaved(false);
      // a fresh solo board means new snakes/ladders — force a full visual resync
      if (lg) {
        lastSeqRef.current = 0;
        snakeSigRef.current = "";
        bridgeRef.current = null;
        directorRef.current = null;
      }
      processState(data);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const saveScore = async () => {
    const st = pubRef.current;
    const c = credsRef.current;
    if (!st || savedRef.current) return;
    const myScore = c ? st.scores[c.pid] ?? 0 : 0;
    if (myScore <= 0) return;
    try {
      await api(`/api/scores`, {
        name: scoreName || c?.name || "Player",
        score: myScore,
        mode: st.mode,
        board: st.board,
        won: st.winner === c?.pid,
        turns: st.moveCount,
      });
      saveLocalScore({ name: scoreName || c?.name || "Player", score: myScore, mode: st.mode, board: st.board, at: Date.now() });
      savedRef.current = true;
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    if (me && !scoreName) setScoreName(me.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  // waiting lobby → go to lobby page (online only; solo starts immediately)
  useEffect(() => {
    if (!isSolo && pub?.status === "waiting" && creds) {
      router.replace(`/lobby/${gameId}`);
    }
  }, [pub?.status, creds, router, gameId, isSolo]);

  const canRoll = Boolean(pub && me && current?.you && pub.status === "playing" && !rolling && !paused);
  const reason = useMemo(() => {
    if (!pub) return "Loading…";
    if (pub.status !== "playing") return "";
    if (!me) return "Spectating";
    if (me.finished) return "You reached the summit!";
    if (current?.you) return "Your turn — SPACE works too";
    return `${current?.name ?? "…"} is thinking`;
  }, [pub, me, current]);

  const winner = pub?.players.find((p) => p.id === pub.winner) ?? null;
  const rows = useMemo(() => {
    if (!pub) return [];
    return [...pub.players]
      .map((p) => ({ name: p.name, color: p.color, score: pub.scores[p.id] ?? 0, you: p.you }))
      .sort((a, b) => b.score - a.score);
  }, [pub]);

  // Snakes glow just before they act — a fire migration or a hunt step.
  const charging = Boolean(
    pub?.status === "playing" &&
      ((pub.mode === "fire" && pub.nextSnakeAt - now < 4500 && pub.nextSnakeAt - now > 0) ||
        (pub.mode === "hunt" && pub.nextCreepAt - now < 1200 && pub.nextCreepAt - now > 0))
  );

  if (!pub) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-[#060b18]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
          <p className="text-sm font-bold tracking-widest text-white/60">SUMMONING THE BOARD…</p>
        </div>
      </div>
    );
  }

  const def = defRef.current ?? getBoard(pub.board, clampSize(pub.size ?? DEFAULT_SIZE));
  const needsJoin = !isSolo && !creds && pub.status === "waiting";
  const elapsed = pub.startedAt ? Math.max(0, Math.floor((now - pub.startedAt) / 1000)) : 0;

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-[#060b18]">
      {/* aurora backdrop */}
      <div className="pointer-events-none absolute inset-0">
        <div className="aurora left-[-10%] top-[-20%] bg-emerald-500/20" />
        <div className="aurora right-[-15%] bottom-[-25%] bg-cyan-500/15" />
      </div>

      {bridgeRef.current && (
        <Scene
          def={def}
          ladders={pub.ladders}
          snakes={pub.snakes}
          snakeVisuals={bridgeRef.current.snakes}
          players={pub.players.map((p) => ({ id: p.id, color: p.color, finished: p.finished }))}
          tokenVisuals={bridgeRef.current.tokens}
          activePlayerId={current?.id}
          activeCell={current && !current.finished ? current.pos : -1}
          charging={charging}
          shake={bridgeRef.current.shake}
          onParticlesReady={(h: ParticlesHandle | null) => {
            if (bridgeRef.current && h) {
              bridgeRef.current.burst = (pos: THREE.Vector3, color: string, count?: number, speed?: number) => h.burst(pos, color, count, speed);
            }
          }}
          rotateSignal={rotateSignal}
          flatView={flatView}
        />
      )}

      {/* HUD */}
      <div
        className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-2 md:p-5"
        style={{
          // respect notches / home indicators on phones
          paddingTop: "max(0.5rem, env(safe-area-inset-top))",
          paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
          paddingLeft: "max(0.5rem, env(safe-area-inset-left))",
          paddingRight: "max(0.5rem, env(safe-area-inset-right))",
        }}
      >
        <div className="flex items-start justify-between gap-2 md:gap-3">
          <PlayerTray
            players={pub.players}
            turnId={current?.id ?? ""}
            last={def.last}
            compact={vp.isPhone}
            speakingPlayerIds={speakingPlayerIds}
          />
          <div className="flex flex-col items-end gap-1.5 md:gap-2">
            <div className="pointer-events-auto flex items-center gap-1.5 md:gap-2">
              <ChatDock
                messages={pub.chat ?? []}
                myId={me?.id ?? ""}
                onSend={(t) => void sendChat(t)}
                disabled={!creds}
                compact={vp.isPhone}
              />
              <TopBar
                code={code}
                mode={pub.mode}
                muted={muted}
                onMute={() => setMuted(sfx.toggleMute())}
                onPause={() => setPaused(true)}
                onHome={onLeaveGame}
                flatView={flatView}
                onToggleView={toggleView}
                compact={vp.isPhone}
                voiceSlot={
                  !isSolo && code && me ? (
                    <VoiceChat
                      roomCode={code}
                      playerName={me.name}
                      playerId={me.id}
                      compact={vp.isPhone}
                      onSpeakingChange={setSpeakingPlayerIds}
                    />
                  ) : undefined
                }
              />
            </div>
            {pub.mode === "fire" && pub.status === "playing" && (
              <FireTimer nextSnakeAt={pub.nextSnakeAt} interval={pub.fireIntervalMs} compact={vp.isPhone} />
            )}
            {pub.mode === "hunt" && pub.status === "playing" && (
              <HuntTimer nextCreepAt={pub.nextCreepAt} interval={pub.huntIntervalMs} compact={vp.isPhone} />
            )}
            {isSolo && pub.status === "playing" && (
              <div
                className={`flex items-center border border-white/10 bg-black/40 backdrop-blur-md ${
                  vp.isPhone ? "gap-2 rounded-xl px-2 py-1" : "gap-3 rounded-2xl px-3.5 py-2"
                }`}
              >
                <div className="flex items-center gap-1">
                  {!vp.isPhone && <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/40">Turns</span>}
                  <span className="font-mono text-xs font-black text-emerald-300 md:text-sm">{pub.moveCount}</span>
                </div>
                <div className="h-4 w-px bg-white/10 md:h-6" />
                <div className="flex items-center gap-1">
                  {!vp.isPhone && <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/40">Time</span>}
                  <span className="font-mono text-xs font-black text-cyan-300 md:text-sm">
                    {String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}
                  </span>
                </div>
              </div>
            )}
            {busy && (
              <div className="rounded-full border border-white/10 bg-black/40 px-3 py-1 text-[10px] font-bold tracking-widest text-white/50 backdrop-blur-md">
                ACTION…
              </div>
            )}
          </div>
        </div>

        <div className="flex items-end justify-between gap-3">
          <div className="mb-1 hidden md:block">
            <LogTicker lines={pub.log} />
          </div>
          <div className="mx-auto md:mx-0">
            {pub.status === "playing" && (
              <RollDock
                dice={pub.dice}
                rolling={rolling}
                canRoll={canRoll}
                reason={reason}
                onRoll={() => void doRoll()}
                compact={vp.isPhone}
              />
            )}
          </div>
          <div className="hidden w-24 md:block" />
        </div>
      </div>

      {/* error toast */}
      <AnimatePresence>
        {err && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute left-1/2 top-16 z-50 -translate-x-1/2 rounded-xl border border-rose-400/40 bg-rose-500/20 px-4 py-2 text-sm font-semibold text-rose-200 backdrop-blur-md"
          >
            {err}
          </motion.div>
        )}
      </AnimatePresence>

      {/* join gate (waiting game, no creds) */}
      <AnimatePresence>
        {needsJoin && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="flex w-full max-w-xs flex-col gap-3 rounded-3xl border border-white/15 bg-slate-950/95 p-6">
              <div className="flex items-center gap-2 text-white">
                <Users className="h-5 w-5 text-emerald-300" />
                <h3 className="font-display text-lg font-black">JOIN LOBBY {code}</h3>
              </div>
              <input
                value={joinName}
                onChange={(e) => setJoinName(e.target.value.slice(0, 14))}
                onKeyDown={(e) => e.key === "Enter" && void joinGame()}
                placeholder="Your name"
                className="rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-400/60"
              />
              <button onClick={() => void joinGame()} className="rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-400 py-3 text-sm font-black uppercase tracking-widest text-slate-950">
                Join game
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* paused */}
      <AnimatePresence>
        {paused && pub.status !== "finished" && (
          <PauseOverlay
            onResume={() => setPaused(false)}
            onQuit={onLeaveGame}
            muted={muted}
            onMute={() => setMuted(sfx.toggleMute())}
            isHost={isHost}
            onDestroy={onDestroyGame}
          />
        )}
      </AnimatePresence>

      {/* terminated overlay */}
      <AnimatePresence>
        {terminatedReason && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
            <motion.div initial={{ scale: 0.9, y: 16 }} animate={{ scale: 1, y: 0 }} className="flex w-full max-w-sm flex-col gap-4 rounded-3xl border border-rose-500/30 bg-slate-950 p-6 text-center shadow-2xl">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/20 text-rose-300 border border-rose-500/30">
                <Trash2 className="h-6 w-6" />
              </div>
              <h3 className="font-display text-xl font-black text-white">Game Terminated</h3>
              <p className="text-xs text-white/60">{terminatedReason}</p>
              <button
                onClick={() => router.push("/")}
                className="rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-400 py-3 text-sm font-black uppercase tracking-widest text-slate-950 transition hover:brightness-110"
              >
                Return to Menu
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* game over — held back until the winning hop/ladder/gulp has played */}
      <AnimatePresence>
        {pub.status === "finished" && winner && !animating && (
          <GameOverOverlay
            winnerName={winner.name}
            winnerColor={winner.color}
            youWon={winner.you}
            rows={rows}
            name={scoreName || winner.name}
            setName={setScoreName}
            onSave={() => void saveScore()}
            saved={saved}
            onRematch={() => void rematch()}
            onHome={() => router.push("/")}
            rematchLabel={isSolo ? "New Run" : "Instant Rematch"}
            subtitle={isSolo ? `${pub.moveCount} turns · ${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : undefined}
          />
        )}
      </AnimatePresence>

      {/* spectator badge */}
      {!me && pub.status === "playing" && (
        <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2 rounded-full border border-white/10 bg-black/50 px-3 py-1.5 text-[11px] font-bold text-white/70 backdrop-blur-md">
          <Bot className="h-3.5 w-3.5" /> Spectating
        </div>
      )}
    </div>
  );
}

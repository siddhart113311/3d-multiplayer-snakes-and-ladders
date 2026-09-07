"use client";

// Single-player runtime: the exact same authoritative engine as the server,
// executed in-browser. No fetch, no polling latency — every roll resolves in
// the same frame it is pressed, so solo play is perfectly responsive offline.

import { BoardShape, BoardSize } from "./boards";
import {
  addChat,
  addPlayer,
  advanceFire,
  applyRoll,
  createState,
  GameMode,
  GameState,
  publicState,
  rematch,
  startGame,
} from "./engine";

export type Difficulty = "chill" | "normal" | "ruthless";

export interface SoloConfig {
  board: BoardShape;
  size: BoardSize;
  mode: GameMode;
  opponents: number; // 0 = pure time-attack run
  difficulty: Difficulty;
  name: string;
  /**
   * Unique id for THIS run, minted when the player presses "Start run" and
   * carried in the URL. A page refresh keeps the id (so the run resumes), but
   * starting again from the menu mints a new id and therefore a new board.
   */
  runId: string;
}

export const LUCK: Record<Difficulty, number> = { chill: 0, normal: 0.14, ruthless: 0.34 };
export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  chill: "Chill",
  normal: "Normal",
  ruthless: "Ruthless",
};

const STORE_KEY = "serp_solo_run_v1";

interface Persisted {
  cfg: SoloConfig;
  state: GameState;
}

export interface LocalResponse {
  gameId: string;
  code: string;
  state: ReturnType<typeof publicState>;
  serverNow: number;
}

function sameConfig(a: SoloConfig, b: SoloConfig) {
  return (
    a.runId === b.runId &&
    a.board === b.board &&
    a.size === b.size &&
    a.mode === b.mode &&
    a.opponents === b.opponents &&
    a.difficulty === b.difficulty
  );
}

export class LocalGame {
  readonly code = "SOLO";
  cfg: SoloConfig;
  state: GameState;
  creds: { pid: string; secret: string; name: string };

  private constructor(cfg: SoloConfig, state: GameState) {
    this.cfg = cfg;
    this.state = state;
    const host = state.players.find((p) => !p.isBot) ?? state.players[0];
    this.creds = { pid: host.id, secret: host.secret, name: host.name };
  }

  /** Resume an in-progress run with identical settings, otherwise deal a fresh board. */
  static create(cfg: SoloConfig): LocalGame {
    const restored = LocalGame.restore(cfg);
    if (restored) return restored;
    return LocalGame.fresh(cfg);
  }

  static fresh(cfg: SoloConfig): LocalGame {
    const seed = `solo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const state = createState(cfg.board, cfg.mode, seed, cfg.size);
    addPlayer(state, cfg.name || "You", false);
    for (let i = 0; i < cfg.opponents; i++) addPlayer(state, "", true, LUCK[cfg.difficulty]);
    startGame(state);
    const g = new LocalGame(cfg, state);
    g.save();
    return g;
  }

  private static restore(cfg: SoloConfig): LocalGame | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as Persisted;
      if (!data?.state?.players?.length) return null;
      if (!sameConfig(data.cfg, cfg)) return null;
      if (data.state.status !== "playing") return null;
      // fire timers are wall-clock based; give the returning player a full interval
      if (data.state.mode === "fire") data.state.nextSnakeAt = Date.now() + data.state.fireIntervalMs;
      return new LocalGame(data.cfg, data.state);
    } catch {
      return null;
    }
  }

  save() {
    if (typeof window === "undefined") return;
    try {
      const payload: Persisted = { cfg: this.cfg, state: this.state };
      window.localStorage.setItem(STORE_KEY, JSON.stringify(payload));
    } catch {
      /* quota — non fatal, the run just won't survive a refresh */
    }
  }

  private respond(pid: string): LocalResponse {
    return { gameId: "solo", code: this.code, state: publicState(this.state, pid), serverNow: Date.now() };
  }

  /** Post a chat message locally (bots still heckle you in single player). */
  say(pid: string, text: string): LocalResponse {
    const me = this.state.players.find((p) => p.id === pid);
    const clean = text.replace(/\s+/g, " ").trim().slice(0, 140);
    if (me && clean) {
      addChat(this.state, { playerId: me.id, name: me.name, color: me.color, text: clean });
      this.save();
    }
    return this.respond(pid);
  }

  /** Mirrors the server route contract so the game UI is transport-agnostic. */
  request(kind: "get" | "roll" | "rematch" | "newRun", pid: string): LocalResponse {
    if (kind === "newRun") {
      // new run id so the reshuffled board is what gets persisted/resumed
      this.cfg = { ...this.cfg, runId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}` };
      const g = LocalGame.fresh(this.cfg);
      this.state = g.state;
      this.creds = g.creds;
      this.save();
      return this.respond(this.creds.pid);
    }

    advanceFire(this.state, Date.now());

    if (kind === "roll") {
      // same rule as the server: a bot's turn is executed on request
      const current = this.state.players[this.state.turn];
      const roller = current?.isBot ? current : this.state.players.find((p) => p.id === pid);
      if (roller) applyRoll(this.state, roller.id, 0);
    } else if (kind === "rematch") {
      if (this.state.status === "finished") rematch(this.state, this.code);
    }

    this.save();
    return this.respond(pid);
  }
}

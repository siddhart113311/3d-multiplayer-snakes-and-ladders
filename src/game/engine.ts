// Server-authoritative game engine for Serpentia.
// State lives as a JSON document; every mutation appends events that clients
// replay locally for smooth, perfectly synced 3D animation.

import { BoardShape, BoardSize, cellNeighbors, clampSize, DEFAULT_SIZE, getBoard, nearestCell } from "./boards";
import { hashStr, mulberry32, rollDice, secureRand, uuid } from "./rng";

export type GameMode = "classic" | "fire" | "hunt";

export interface Player {
  id: string;
  secret: string;
  name: string;
  color: string;
  isBot: boolean;
  pos: number; // -1 = staging, 0..last = cell index
  finished: boolean;
  finishOrder: number;
  ladders: number;
  gulped: number;
  /** 0 = perfectly fair dice. >0 = chance to take the better of two rolls (bot difficulty). */
  luck?: number;
  /** Timestamp (ms) when this player last communicated with the server. */
  lastSeen?: number;
}

export interface Snake {
  id: number;
  head: number;
  tail: number;
  /** Body length in world units — preserved while the snake crawls in hunt mode. */
  span?: number;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  name: string;
  color: string;
  text: string;
  at: number;
  taunt?: boolean;
}

export const MAX_CHAT = 60;

/** Canned smack-talk offered as one-tap buttons in the chat dock. */
export const TAUNTS = [
  "Get gulped, loser 🐍",
  "That ladder had your name on it… mine now 🪜",
  "Skill issue.",
  "Cry about it 😭",
  "I've seen glaciers move faster",
  "Say goodbye to your ego 💀",
  "Snake food detected 🍽️",
  "Was that your best roll? Adorable.",
  "Bro fell for the oldest snake in the book",
  "GG EZ 😎",
];

const BOT_TAUNTS = {
  bitten: ["Down you go! 🐍", "Enjoy the slide, pal", "That's gotta hurt 💀", "Snack time!"],
  ladder: ["Up and away! 🪜", "Catch me if you can", "Elevator going up 😎", "Too easy."],
  selfBitten: ["…okay that one hurt", "Rigged dice, I swear", "I meant to do that", "Ow."],
};

export function normalizeState(state: GameState): GameState {
  // Backward compatibility for JSONB rows written by earlier app versions.
  state.size = clampSize(state.size ?? DEFAULT_SIZE);
  state.players ??= [];
  state.snakes ??= [];
  state.ladders ??= [];
  state.events ??= [];
  state.log ??= [];
  state.chat ??= [];
  state.scores ??= {};
  state.seq ??= 0;
  state.moveCount ??= 0;
  state.turn ??= 0;
  state.dice ??= 0;
  state.fireCursor ??= 0;
  state.fireIntervalMs ??= FIRE_INTERVAL;
  state.nextSnakeAt ??= 0;
  state.huntIntervalMs ??= HUNT_INTERVAL;
  state.nextCreepAt ??= 0;
  state.lastActionAt ??= 0;
  for (const p of state.players) {
    p.pos ??= -1;
    p.finished ??= false;
    p.finishOrder ??= 0;
    p.ladders ??= 0;
    p.gulped ??= 0;
    p.lastSeen ??= Date.now();
  }
  if (!state.hostId && state.players[0]) {
    state.hostId = state.players[0].id;
  }
  return state;
}

export function addChat(state: GameState, msg: Omit<ChatMessage, "id" | "at">): ChatMessage {
  normalizeState(state);
  const full: ChatMessage = { ...msg, id: uuid(), at: Date.now() };
  state.chat.push(full);
  if (state.chat.length > MAX_CHAT) state.chat.splice(0, state.chat.length - MAX_CHAT);
  return full;
}

function botTaunt(state: GameState, bot: Player, kind: keyof typeof BOT_TAUNTS) {
  const pool = BOT_TAUNTS[kind];
  addChat(state, {
    playerId: bot.id,
    name: bot.name,
    color: bot.color,
    text: pool[Math.floor(secureRand() * pool.length)],
    taunt: true,
  });
}

export interface Ladder {
  bottom: number;
  top: number;
}

export type GameEvent =
  | { seq: number; type: "roll"; playerId: string; dice: number }
  | { seq: number; type: "hop"; playerId: string; path: number[] }
  | { seq: number; type: "ladder"; playerId: string; from: number; to: number }
  | { seq: number; type: "snakeBite"; playerId: string; snakeId: number; from: number; to: number; gulp: boolean }
  | {
      seq: number;
      type: "snakeShift";
      snake: Snake;
      prev: Snake;
      gulped: Array<{ playerId: string; from: number; to: number }>;
    }
  | {
      seq: number;
      type: "snakeCreep";
      /** All stalking snakes move in one batch so clients animate them together. */
      moves: Array<{ snake: Snake; prev: Snake }>;
      gulped: Array<{ playerId: string; snakeId: number; from: number; to: number }>;
    }
  | { seq: number; type: "win"; playerId: string }
  | { seq: number; type: "restart" }
  | { seq: number; type: "start" };

export interface GameState {
  board: BoardShape;
  size: BoardSize;
  mode: GameMode;
  status: "waiting" | "playing" | "finished";
  hostId: string;
  players: Player[];
  turn: number;
  dice: number;
  snakes: Snake[];
  ladders: Ladder[];
  winner: string | null;
  events: GameEvent[];
  seq: number;
  log: string[];
  chat: ChatMessage[];
  moveCount: number;
  fireCursor: number;
  fireIntervalMs: number;
  nextSnakeAt: number; // epoch ms (fire mode)
  huntIntervalMs: number;
  nextCreepAt: number; // epoch ms (hunt mode)
  startedAt: number | null;
  finishedAt: number | null;
  lastActionAt: number;
  scores: Record<string, number>;
}

export const PLAYER_COLORS = ["#ff4d5e", "#38bdf8", "#fbbf24", "#a78bfa"];
export const MAX_PLAYERS = 4;
export const FIRE_INTERVAL = 18000;
/** Hunt mode: how often the stalking pack advances, and how many snakes hunt. */
export const HUNT_INTERVAL = 2600;
export const HUNT_SNAKES = 5;
const BOT_NAMES = ["Viper", "Kaa", "Nagini", "Scales", "Basilisk", "Slyther"];

type EventPayload = { [K in GameEvent["type"]]: Extract<GameEvent, { type: K }> extends infer E ? (E extends { seq: number } ? Omit<E, "seq"> : never) : never }[GameEvent["type"]];

function pushEvent(state: GameState, ev: EventPayload) {
  state.seq += 1;
  state.events.push({ ...ev, seq: state.seq } as GameEvent);
  if (state.events.length > 400) state.events.splice(0, state.events.length - 400);
}

function logLine(state: GameState, line: string) {
  state.log.push(line);
  if (state.log.length > 8) state.log.splice(0, state.log.length - 8);
}

export function logLinePublic(state: GameState, line: string) {
  logLine(state, line);
}

/**
 * Generate snakes & ladders for a board.
 *
 * Defaults to true randomness so every single game deals a brand new layout.
 * The generated arrays are stored in game state and shipped to clients verbatim,
 * so there is no need for the layout to be re-derivable from a seed. A seed can
 * still be supplied for reproducible tests.
 */
export function genFeatures(shape: BoardShape, seedKey?: string, size: BoardSize = DEFAULT_SIZE): { snakes: Snake[]; ladders: Ladder[] } {
  const def = getBoard(shape, size);
  const rng = seedKey === undefined ? secureRand : mulberry32(hashStr(`features:${seedKey}:${shape}:${secureRand()}`));
  const N = def.cells.length;
  const last = N - 1;
  const used = new Set<number>([0, last]);
  // Scale hazards with board size so density stays fun on the larger boards.
  // Scale hazards with board size. Small boards need proportionally fewer (and
  // must leave room for them: a 19-cell board can't host 5 snakes + 5 ladders).
  const density = Math.round(N / 17);
  const roomFor = Math.max(1, Math.floor((N - 4) / 8));
  const snakeCount = Math.max(1, Math.min(density < 2 ? 2 : density, roomFor));
  const ladderCount = snakeCount;

  const take = (min: number, max: number): number | null => {
    for (let tries = 0; tries < 200; tries++) {
      const v = min + Math.floor(rng() * (max - min + 1));
      if (!used.has(v)) {
        used.add(v);
        return v;
      }
    }
    return null;
  };

  // Minimum span of a hazard, proportional to the board (never below 2 cells)
  // so tiny boards still generate valid, meaningful jumps.
  const minSpan = Math.max(2, Math.round(N * 0.06));

  const ladders: Ladder[] = [];
  for (let i = 0; i < ladderCount; i++) {
    const bottom = take(1, Math.max(2, last - minSpan - 1));
    if (bottom == null) continue;
    const minTop = Math.min(bottom + minSpan, last - 1);
    const top = take(minTop, last - 1);
    if (top == null || top <= bottom + 1) {
      if (top != null) used.delete(top);
      used.delete(bottom);
      continue;
    }
    ladders.push({ bottom, top });
  }

  const snakes: Snake[] = [];
  for (let i = 0; i < snakeCount; i++) {
    const headMin = Math.min(Math.max(minSpan + 2, Math.floor(N * 0.28)), last - 2);
    const head = take(headMin, last - 1);
    if (head == null) continue;
    const minTail = Math.max(1, head - Math.max(minSpan, Math.floor(N * 0.45)));
    const tail = take(minTail, Math.max(minTail, head - minSpan));
    if (tail == null || tail >= head) {
      if (tail != null) used.delete(tail);
      used.delete(head);
      continue;
    }
    snakes.push({ id: i, head, tail, span: cellDistance(def, head, tail) });
  }
  return { snakes, ladders };
}

/** World-space distance between two cells. */
function cellDistance(def: ReturnType<typeof getBoard>, a: number, b: number): number {
  const ca = def.cells[Math.max(0, Math.min(def.last, a))];
  const cb = def.cells[Math.max(0, Math.min(def.last, b))];
  return Math.hypot(ca.x - cb.x, ca.z - cb.z);
}

export function createState(board: BoardShape, mode: GameMode, code: string, size: BoardSize = DEFAULT_SIZE): GameState {
  const boardSize = clampSize(size);
  // no seed → a fresh random layout for every game
  const { snakes, ladders } = genFeatures(board, undefined, boardSize);
  void code;
  return {
    board,
    size: boardSize,
    mode,
    status: "waiting",
    hostId: "",
    players: [],
    turn: 0,
    dice: 0,
    snakes,
    ladders,
    winner: null,
    events: [],
    seq: 0,
    log: [],
    chat: [],
    moveCount: 0,
    fireCursor: 0,
    fireIntervalMs: FIRE_INTERVAL,
    nextSnakeAt: 0,
    huntIntervalMs: HUNT_INTERVAL,
    nextCreepAt: 0,
    startedAt: null,
    finishedAt: null,
    lastActionAt: 0,
    scores: {},
  };
}

export function addPlayer(state: GameState, name: string, isBot: boolean, luck = 0): Player | null {
  if (state.players.length >= MAX_PLAYERS) return null;
  const botCount = state.players.filter((p) => p.isBot).length;
  const player: Player = {
    id: uuid(),
    secret: uuid(),
    name: isBot ? BOT_NAMES[(botCount + state.moveCount) % BOT_NAMES.length] : name.slice(0, 14) || "Player",
    color: PLAYER_COLORS[state.players.length % PLAYER_COLORS.length],
    isBot,
    pos: -1,
    finished: false,
    finishOrder: 0,
    ladders: 0,
    gulped: 0,
    luck: isBot ? luck : 0,
    lastSeen: Date.now(),
  };
  state.players.push(player);
  if (!state.hostId) state.hostId = player.id;
  return player;
}

export function startGame(state: GameState) {
  state.status = "playing";
  state.startedAt = Date.now();
  state.dice = 0;
  state.nextSnakeAt = Date.now() + state.fireIntervalMs;
  state.nextCreepAt = Date.now() + (state.huntIntervalMs || HUNT_INTERVAL);
  pushEvent(state, { type: "start" });
  logLine(state, state.mode === "hunt" ? "The pack has your scent — run!" : "Game started — good luck!");
}

export function computeScores(state: GameState) {
  const def = getBoard(state.board, clampSize(state.size ?? DEFAULT_SIZE));
  const cells = def.cells.length;
  const players = Math.max(1, state.players.length);
  // Bigger boards are worth more, and pace is judged against a par derived from
  // the board size (avg dice 3.5) rather than a flat per-turn penalty — otherwise
  // long boards would always score lower than short ones.
  const sizeBonus = Math.round(cells * 2.2);
  const par = (cells / 3.5) * players;

  for (const p of state.players) {
    const isWinner = p.id === state.winner;
    const progress = Math.max(0, p.pos) / def.last;
    const base = isWinner ? 1000 : Math.round(progress * 600);
    const efficiency = isWinner ? Math.round(clamp(1 - state.moveCount / Math.max(1, par), -0.5, 0.6) * 500) : 0;
    state.scores[p.id] = Math.max(
      50,
      base +
        (isWinner ? sizeBonus : Math.round(sizeBonus * progress * 0.4)) +
        efficiency +
        p.ladders * 45 -
        p.gulped * 20 +
        (state.mode === "fire" ? 200 : state.mode === "hunt" ? 275 : 0)
    );
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function advanceTurn(state: GameState) {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (state.turn + i) % n;
    if (!state.players[idx].finished) {
      state.turn = idx;
      return;
    }
  }
}

function finishPlayer(state: GameState, p: Player) {
  p.finished = true;
  p.finishOrder = state.players.filter((x) => x.finished).length;
  pushEvent(state, { type: "win", playerId: p.id });
  logLine(state, `${p.name} reached the summit!`);
  const alive = state.players.filter((x) => !x.finished);
  if (state.winner == null) {
    state.winner = p.id;
    state.status = "finished";
    state.finishedAt = Date.now();
    computeScores(state);
  } else if (alive.length <= 1) {
    state.status = "finished";
    state.finishedAt = Date.now();
    computeScores(state);
  }
}

export interface RollResult {
  ok: boolean;
  error?: string;
}

/** Where a roll lands, accounting for bounce-back past the summit. */
function destOf(pos: number, dice: number, last: number): number {
  const raw = pos + dice;
  return raw <= last ? raw : last - (raw - last);
}

/**
 * How good a landing square is. Note a *bigger* roll is often worse — it can
 * bounce back off the summit or drop onto a snake head — so difficulty is
 * modelled as board awareness rather than raw dice inflation.
 */
function evalDest(state: GameState, dest: number, last: number): number {
  if (dest === last) return 1e6;
  const ladder = state.ladders.find((l) => l.bottom === dest);
  if (ladder) return ladder.top * 10 + 400;
  const snake = state.snakes.find((s) => s.head === dest);
  if (snake) return snake.tail * 10 - 400;
  return dest * 10;
}

/**
 * @param throttleMs anti-spam guard for networked play. Local single-player passes
 *   0 because the client already gates rolls behind the dice animation, and a solo
 *   player keeps the turn (so the "not your turn" check can't absorb fast taps).
 */
export function applyRoll(state: GameState, playerId: string, throttleMs = 400): RollResult {
  if (state.status !== "playing") return { ok: false, error: "Game is not playing" };
  const p = state.players[state.turn];
  if (!p || p.id !== playerId) return { ok: false, error: "Not your turn" };
  if (p.finished) return { ok: false, error: "Already finished" };
  const now = Date.now();
  if (throttleMs > 0 && now - state.lastActionAt < throttleMs) return { ok: false, error: "Too fast" };
  state.lastActionAt = now;

  const def = getBoard(state.board, clampSize(state.size ?? DEFAULT_SIZE));
  const last = def.last;
  // Fair d6 for humans. Difficulty-weighted bots sometimes get a second look and
  // keep whichever roll leads to the smarter square (ladder > open board > snake).
  let dice = rollDice();
  if (p.luck && p.luck > 0 && secureRand() < p.luck) {
    const alt = rollDice();
    if (evalDest(state, destOf(p.pos, alt, last), last) > evalDest(state, destOf(p.pos, dice, last), last)) {
      dice = alt;
    }
  }
  state.dice = dice;
  state.moveCount += 1;
  pushEvent(state, { type: "roll", playerId: p.id, dice });

  // Build the hop path with bounce-back at the summit.
  const raw = p.pos + dice;
  const path: number[] = [];
  if (raw <= last) {
    for (let i = p.pos + 1; i <= raw; i++) path.push(i);
  } else {
    for (let i = p.pos + 1; i <= last; i++) path.push(i);
    const over = raw - last;
    for (let i = last - 1; i >= last - over; i--) path.push(i);
  }
  const dest = path[path.length - 1];
  pushEvent(state, { type: "hop", playerId: p.id, path });
  p.pos = dest;
  logLine(state, `${p.name} rolled ${dice} → cell ${dest + 1}`);

  if (dest === last) {
    finishPlayer(state, p);
    return { ok: true };
  }

  const ladder = state.ladders.find((l) => l.bottom === dest);
  if (ladder) {
    p.pos = ladder.top;
    p.ladders += 1;
    pushEvent(state, { type: "ladder", playerId: p.id, from: dest, to: ladder.top });
    logLine(state, `${p.name} climbed a ladder to ${ladder.top + 1}!`);
    if (p.isBot && secureRand() < 0.4) botTaunt(state, p, "ladder");
    if (ladder.top === last) {
      finishPlayer(state, p);
      return { ok: true };
    }
  } else {
    const snake = state.snakes.find((s) => s.head === dest);
    if (snake) {
      p.pos = snake.tail;
      p.gulped += 1;
      const gulp = state.mode === "fire";
      pushEvent(state, { type: "snakeBite", playerId: p.id, snakeId: snake.id, from: dest, to: snake.tail, gulp });
      logLine(state, gulp ? `${p.name} was GULPED by a serpent!` : `${p.name} slid down a snake…`);
      if (p.isBot) {
        if (secureRand() < 0.5) botTaunt(state, p, "selfBitten");
      } else {
        // a bot heckles the human who just got eaten
        const heckler = state.players.find((x) => x.isBot && !x.finished);
        if (heckler && secureRand() < 0.65) botTaunt(state, heckler, "bitten");
      }
    }
  }

  advanceTurn(state);
  return { ok: true };
}

/** Fire-mode: migrate one snake when its timer elapses, gulping players on its path. */
/**
 * Pick the neighbouring cell that gets closest to `target`, subject to `allow`.
 * Returns `from` unchanged when no neighbour is an improvement.
 */
function stepToward(
  def: ReturnType<typeof getBoard>,
  from: number,
  target: { x: number; z: number },
  allow: (idx: number) => boolean
): number {
  const here = def.cells[from];
  let best = from;
  let bestD = Math.hypot(here.x - target.x, here.z - target.z);
  for (const n of cellNeighbors(def, from)) {
    if (!allow(n)) continue;
    const c = def.cells[n];
    const d = Math.hypot(c.x - target.x, c.z - target.z);
    if (d < bestD - 1e-6) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

/** One stalking tick: the nearest snakes each crawl a single cell toward the prey. */
function creepOnce(state: GameState, def: ReturnType<typeof getBoard>) {
  const last = def.last;
  const onBoard = state.players.filter((p) => !p.finished && p.pos >= 0);
  if (onBoard.length === 0 || state.snakes.length === 0) return;

  // The pack focuses on whoever is about to move; otherwise the leader.
  const current = state.players[state.turn];
  const prey =
    current && !current.finished && current.pos >= 0
      ? current
      : onBoard.reduce((a, b) => (b.pos > a.pos ? b : a));
  const preyPos = def.cells[prey.pos];

  const blocked = new Set<number>([0, last]);
  for (const l of state.ladders) {
    blocked.add(l.bottom);
    blocked.add(l.top);
  }
  const heads = new Set(state.snakes.map((s) => s.head));

  // Only the closest few actually hunt — the rest stay put as normal hazards.
  const pack = [...state.snakes]
    .map((s) => ({ s, d: cellDistance(def, s.head, prey.pos) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, Math.min(HUNT_SNAKES, state.snakes.length));

  const moves: Array<{ snake: Snake; prev: Snake }> = [];
  const gulped: Array<{ playerId: string; snakeId: number; from: number; to: number }> = [];

  for (const { s } of pack) {
    const prev: Snake = { ...s };
    s.span ??= cellDistance(def, s.head, s.tail);

    // Head crawls one cell closer. Staying above its own tail keeps the snake
    // pointing down-board, so a gulp can never fling a player *forward*.
    heads.delete(s.head);
    const nextHead = stepToward(def, s.head, preyPos, (i) => !blocked.has(i) && !heads.has(i) && i > s.tail + 1);
    s.head = nextHead;
    heads.add(nextHead);

    // Body trails: the tail only creeps up when the head has stretched it.
    const prevHeadPos = def.cells[prev.head];
    let guard = 0;
    while (cellDistance(def, s.head, s.tail) > s.span * 1.12 && guard++ < 3) {
      const nextTail = stepToward(def, s.tail, prevHeadPos, (i) => i >= 1 && i < s.head - 1);
      if (nextTail === s.tail) break;
      s.tail = nextTail;
    }

    // Anything standing where the head landed is swallowed.
    for (const p of state.players) {
      if (p.finished || p.pos < 0) continue;
      if (p.pos === s.head) {
        gulped.push({ playerId: p.id, snakeId: s.id, from: p.pos, to: s.tail });
        p.pos = s.tail;
        p.gulped += 1;
        logLine(state, `${p.name} was run down and gulped!`);
      }
    }

    if (prev.head !== s.head || prev.tail !== s.tail) moves.push({ snake: { ...s }, prev });
  }

  if (moves.length || gulped.length) {
    pushEvent(state, { type: "snakeCreep", moves, gulped });
  }
}

/** Hunt mode: the pack closes in on its prey a cell at a time. */
export function advanceHunt(state: GameState, now: number) {
  if (state.mode !== "hunt" || state.status !== "playing" || !state.nextCreepAt) return;
  if (now < state.nextCreepAt) return;
  const def = getBoard(state.board, clampSize(state.size ?? DEFAULT_SIZE));
  const interval = state.huntIntervalMs || HUNT_INTERVAL;
  let iterations = 0;
  while (now >= state.nextCreepAt && iterations < 3) {
    iterations += 1;
    state.nextCreepAt += interval;
    creepOnce(state, def);
  }
  if (now >= state.nextCreepAt) state.nextCreepAt = now + interval;
}

/** Advance every time-driven hazard for the active mode. */
export function advanceWorld(state: GameState, now: number) {
  advanceFire(state, now);
  advanceHunt(state, now);
}

/** Timeout after which an inactive player is considered disconnected/unresponsive (18 seconds). */
export const UNRESPONSIVE_TIMEOUT_MS = 18000;

export interface LivenessResult {
  hostUnresponsive: boolean;
  changed: boolean;
  becameCpu: string[];
}

/**
 * Check if players have disconnected or become unresponsive.
 * - If host has been silent >18s: caller should terminate the game.
 * - If any client has been silent >18s during active play: convert to CPU bot so game keeps moving.
 */
export function checkPlayerLiveness(state: GameState, now: number): LivenessResult {
  let changed = false;
  const becameCpu: string[] = [];
  const host = state.players.find((p) => p.id === state.hostId);
  const hostUnresponsive = Boolean(
    host &&
      !host.isBot &&
      host.lastSeen &&
      now - host.lastSeen > UNRESPONSIVE_TIMEOUT_MS
  );

  if (state.status === "playing") {
    for (const p of state.players) {
      if (
        p.id !== state.hostId &&
        !p.isBot &&
        !p.finished &&
        p.lastSeen &&
        now - p.lastSeen > UNRESPONSIVE_TIMEOUT_MS
      ) {
        p.isBot = true;
        if (!p.name.includes("(CPU)")) {
          p.name = `${p.name} (CPU)`;
        }
        logLine(state, `${p.name} disconnected and was replaced by CPU.`);
        becameCpu.push(p.name);
        changed = true;
      }
    }
  }

  return { hostUnresponsive, changed, becameCpu };
}

export function advanceFire(state: GameState, now: number) {
  if (state.mode !== "fire" || state.status !== "playing" || !state.nextSnakeAt) return;
  if (now < state.nextSnakeAt) return;

  const def = getBoard(state.board, clampSize(state.size ?? DEFAULT_SIZE));
  const last = def.last;
  let iterations = 0;
  while (now >= state.nextSnakeAt && iterations < 2) {
    iterations += 1;
    state.nextSnakeAt += state.fireIntervalMs;
    if (state.snakes.length === 0) break;
    const snake = state.snakes[state.fireCursor % state.snakes.length];
    state.fireCursor += 1;
    const prev: Snake = { ...snake };
    const len = Math.max(5, snake.head - snake.tail);

    // choose a new head away from features & the summit
    const blocked = new Set<number>([0, last]);
    for (const l of state.ladders) {
      blocked.add(l.bottom);
      blocked.add(l.top);
    }
    let head = -1;
    for (let tries = 0; tries < 60; tries++) {
      const v = Math.max(10, Math.floor(last * 0.25)) + Math.floor(Math.random() * (last - Math.max(10, Math.floor(last * 0.25)) - 3));
      if (v - len < 2) continue;
      if (blocked.has(v)) continue;
      let clash = false;
      for (const s of state.snakes) {
        if (s.id !== snake.id && (s.head === v || s.tail === v)) clash = true;
      }
      if (!clash) {
        head = v;
        break;
      }
    }
    if (head === -1) continue;
    snake.head = head;
    snake.tail = head - len;

    // corridor sweep: who stands on the snake's slither path (or its new head)?
    const h0 = def.cells[prev.head];
    const h1 = def.cells[snake.head];
    const corridor = new Set<number>([snake.head]);
    for (let i = 0; i <= 26; i++) {
      const t = i / 26;
      const x = h0.x + (h1.x - h0.x) * t;
      const z = h0.z + (h1.z - h0.z) * t;
      corridor.add(nearestCell(def, x, z));
    }
    const gulped: Array<{ playerId: string; from: number; to: number }> = [];
    for (const p of state.players) {
      if (p.finished || p.pos < 0) continue;
      if (corridor.has(p.pos)) {
        gulped.push({ playerId: p.id, from: p.pos, to: snake.tail });
        p.pos = snake.tail;
        p.gulped += 1;
        logLine(state, `${p.name} was gulped mid-slither!!`);
      }
    }
    pushEvent(state, { type: "snakeShift", snake: { ...snake }, prev, gulped });
    logLine(state, `A serpent slithers across the board!`);
  }
  if (now >= state.nextSnakeAt) state.nextSnakeAt = now + state.fireIntervalMs;
}

export function rematch(state: GameState, code: string) {
  const fresh = createState(state.board, state.mode, `${code}:${Date.now()}`, clampSize(state.size ?? DEFAULT_SIZE));
  for (const p of state.players) {
    p.pos = -1;
    p.finished = false;
    p.finishOrder = 0;
    p.ladders = 0;
    p.gulped = 0;
  }
  state.snakes = fresh.snakes;
  state.ladders = fresh.ladders;
  state.winner = null;
  state.turn = 0;
  state.dice = 0;
  state.status = "playing";
  state.moveCount = 0;
  state.fireCursor = 0;
  state.scores = {};
  state.startedAt = Date.now();
  state.finishedAt = null;
  state.nextSnakeAt = Date.now() + state.fireIntervalMs;
  state.nextCreepAt = Date.now() + (state.huntIntervalMs || HUNT_INTERVAL);
  pushEvent(state, { type: "restart" });
  logLine(state, "Rematch! Board reshuffled.");
}

/** Client-safe copy: strip player secrets, include "you" marker. */
export function publicState(state: GameState, forPlayerId?: string) {
  normalizeState(state);
  return {
    ...state,
    events: state.events.slice(-60),
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      isBot: p.isBot,
      pos: p.pos,
      finished: p.finished,
      finishOrder: p.finishOrder,
      ladders: p.ladders,
      gulped: p.gulped,
      lastSeen: p.lastSeen,
      you: p.id === forPlayerId,
    })),
  };
}

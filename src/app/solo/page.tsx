import GameClient from "../game/[id]/GameClient";
import { BOARD_SHAPES, BoardShape, clampSize, DEFAULT_SIZE } from "@/game/boards";
import type { Difficulty } from "@/game/localGame";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? "" : v ?? "");

export default async function SoloPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const rawBoard = one(sp.board) as BoardShape;
  const board: BoardShape = BOARD_SHAPES.includes(rawBoard) ? rawBoard : "square";
  const mode = one(sp.mode) === "fire" ? "fire" : "classic";
  const rawDiff = one(sp.diff);
  const difficulty: Difficulty = rawDiff === "chill" || rawDiff === "ruthless" ? rawDiff : "normal";
  const opponents = Math.max(0, Math.min(3, Number(one(sp.ops) || 2)));
  const name = one(sp.name).slice(0, 14) || "You";
  // no run id (e.g. a hand-typed URL) → treat as a brand new run
  const runId = one(sp.run).slice(0, 24) || `r${Date.now()}`;
  const size = clampSize(Number(one(sp.size) || DEFAULT_SIZE));

  return <GameClient key={runId} solo={{ board, size, mode, opponents, difficulty, name, runId }} />;
}

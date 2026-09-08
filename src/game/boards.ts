// Board topology + world geometry for all 3 board shapes.
// Pure functions — shared by the server engine and the client renderer.

export type BoardShape = "square" | "hex" | "triangle";

/** 10 size steps, shared by every shape. 0 = tiny skirmish, 9 = 225-cell epic. */
export type BoardSize = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export const BOARD_SIZE_STEPS: BoardSize[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
export const DEFAULT_SIZE: BoardSize = 5;
export const MAX_CELLS = 225;

export interface CellPos {
  x: number;
  z: number;
  rot?: number; // for triangle cells orientation
}

export interface BoardDef {
  shape: BoardShape;
  size: BoardSize;
  label: string;
  cells: CellPos[]; // ordered along the play path, index 0 = first cell
  last: number; // cells.length - 1
  cellSize: number;
  center: { x: number; z: number };
  radius: number; // bounding radius (for camera fit / base platform)
  start: { x: number; z: number }; // off-board staging point
}

/**
 * Per-shape dimension for each of the 10 steps, chosen so all three shapes
 * grow at a comparable pace and every shape tops out at exactly 225 cells.
 *   square:   N×N grid
 *   hex:      R rings  -> 1 + 3R(R+1) cells
 *   triangle: M rows   -> M² cells
 */
const SQUARE_N = [5, 6, 7, 8, 9, 10, 11, 12, 13, 15] as const; // 25 … 225
const TRI_ROWS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 15] as const; // 25 … 225
/**
 * Hex grows as 1+3R(R+1), which only yields 8 usable ring counts under 225.
 * To still give 10 DISTINCT sizes we trim a partial outer ring on some steps
 * (cells are removed from the end of the spiral, so the path stays contiguous).
 */
const HEX_RINGS = [3, 3, 4, 5, 5, 6, 6, 7, 7, 8] as const;
const HEX_TRIM = [12, 1, 12, 27, 10, 27, 6, 25, 0, 0] as const; // cells dropped from the outer ring


/** Cells produced by a given shape+size (no geometry built). */
export function cellCount(shape: BoardShape, size: BoardSize): number {
  const s = clampSize(size);
  if (shape === "square") return SQUARE_N[s] ** 2;
  if (shape === "triangle") return TRI_ROWS[s] ** 2;
  const r = HEX_RINGS[s];
  return 1 + 3 * r * (r + 1) - HEX_TRIM[s];
}

export function clampSize(size: number): BoardSize {
  const n = Math.round(Number.isFinite(size) ? size : DEFAULT_SIZE);
  return Math.max(0, Math.min(9, n)) as BoardSize;
}

/**
 * Target on-screen footprint. Keeping this constant across sizes means the
 * camera framing stays put and — crucially — cells shrink as the count grows,
 * so numbers stay proportionally legible instead of the board sprawling.
 */
const TARGET_RADIUS = 8.4;

function buildSquare(size: BoardSize): BoardDef {
  const N = SQUARE_N[size];
  // spacing derived from the target footprint rather than a fixed constant
  const spacing = (TARGET_RADIUS * 2) / (N + 1.6);
  const cells: CellPos[] = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      // boustrophedon (snake pattern) numbering
      const col = r % 2 === 0 ? c : N - 1 - c;
      cells.push({
        x: (col - (N - 1) / 2) * spacing,
        z: (r - (N - 1) / 2) * spacing,
      });
    }
  }
  const radius = ((N - 1) / 2 + 1) * spacing;
  return {
    shape: "square",
    size,
    label: "Classic Square",
    cells,
    last: cells.length - 1,
    cellSize: spacing * 0.93,
    center: { x: 0, z: 0 },
    radius,
    start: { x: cells[0].x - spacing * 1.4, z: cells[0].z - spacing * 1.1 },
  };
}

// Hex spiral: rings of hex cells spiralling outward from the centre.
function buildHex(size: BoardSize): BoardDef {
  const RINGS = HEX_RINGS[size];
  const hexSize = (TARGET_RADIUS * 0.62) / (RINGS + 0.9);
  const dirs: Array<[number, number]> = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ];
  const toWorld = (q: number, r: number) => ({
    x: hexSize * Math.sqrt(3) * (q + r / 2),
    z: hexSize * 1.5 * r,
  });
  const cells: CellPos[] = [{ ...toWorld(0, 0) }];
  for (let ring = 1; ring <= RINGS; ring++) {
    const ringCells: CellPos[] = [];
    let q = dirs[4][0] * ring;
    let r = dirs[4][1] * ring;
    for (let d = 0; d < 6; d++) {
      for (let i = 0; i < ring; i++) {
        q += dirs[d][0];
        r += dirs[d][1];
        ringCells.push(toWorld(q, r));
      }
    }
    // Walk each ring starting from whichever cell is nearest the previous ring's
    // last cell, in whichever direction keeps going. Without this the spiral
    // teleports across the board every time it steps out a ring.
    const prev = cells[cells.length - 1];
    let bestStart = 0;
    let bestD = Infinity;
    ringCells.forEach((c, i) => {
      const d = (c.x - prev.x) ** 2 + (c.z - prev.z) ** 2;
      if (d < bestD) {
        bestD = d;
        bestStart = i;
      }
    });
    const n = ringCells.length;
    const ordered: CellPos[] = [];
    const fwd = ringCells[(bestStart + 1) % n];
    const bwd = ringCells[(bestStart - 1 + n) % n];
    const dirSign =
      (fwd.x - prev.x) ** 2 + (fwd.z - prev.z) ** 2 >= (bwd.x - prev.x) ** 2 + (bwd.z - prev.z) ** 2 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      ordered.push(ringCells[(bestStart + dirSign * i + n * 2) % n]);
    }
    cells.push(...ordered);
  }
  // trim a partial outer ring (from the spiral's end) to hit the target count
  const trim = HEX_TRIM[size];
  if (trim > 0) cells.length = Math.max(1, cells.length - trim);
  // centre the board
  const mx = cells.reduce((s, c) => s + c.x, 0) / cells.length;
  const mz = cells.reduce((s, c) => s + c.z, 0) / cells.length;
  for (const c of cells) {
    c.x -= mx;
    c.z -= mz;
  }
  const radius = Math.max(...cells.map((c) => Math.hypot(c.x, c.z))) + hexSize * 1.6;
  const first = cells[0];
  return {
    shape: "hex",
    size,
    label: "Hive Spiral",
    cells,
    last: cells.length - 1,
    // circumdiameter shrunk so neighbouring hexes leave a clear gutter
    cellSize: hexSize * 1.76,
    center: { x: 0, z: 0 },
    radius,
    start: { x: first.x - hexSize * 2.6, z: first.z + hexSize * 2 },
  };
}

// Triangle: big triangle subdivided into small triangular cells, boustrophedon rows.
function buildTriangle(size: BoardSize): BoardDef {
  const M = TRI_ROWS[size];
  const side = (TARGET_RADIUS * 2.05) / (M + 1.2);
  const h = (side * Math.sqrt(3)) / 2;
  const totalH = M * h;
  const cells: CellPos[] = [];

  for (let r = 0; r < M; r++) {
    const count = 2 * r + 1;
    const idxs = [...Array(count).keys()];
    const order = r % 2 === 0 ? idxs : idxs.reverse();
    const zTop = totalH / 2 - r * h; // top edge of this row (apex side is +z)
    for (const j of order) {
      const up = j % 2 === 0;
      cells.push({
        x: (j - r) * (side / 2),
        // A triangle's centroid sits 1/3 of the height from its base, so up- and
        // down-pointing cells in the SAME row have different centres.
        z: up ? zTop - (2 * h) / 3 : zTop - h / 3,
        rot: up ? 0 : Math.PI,
      });
    }
  }
  const radius = Math.max(...cells.map((c) => Math.hypot(c.x, c.z))) + side * 0.75;
  return {
    shape: "triangle",
    size,
    label: "Prism Peak",
    cells,
    last: cells.length - 1,
    // shrunk below the full tessellation size so tiles have a visible gap
    cellSize: side * 0.853,
    center: { x: 0, z: 0 },
    radius,
    start: { x: cells[0].x - side * 1.25, z: cells[0].z + side },
  };
}

const cache = new Map<string, BoardDef>();

export function getBoard(shape: BoardShape, size: BoardSize = DEFAULT_SIZE): BoardDef {
  const s = clampSize(size);
  const key = `${shape}:${s}`;
  let def = cache.get(key);
  if (!def) {
    def = shape === "square" ? buildSquare(s) : shape === "hex" ? buildHex(s) : buildTriangle(s);
    cache.set(key, def);
  }
  return def;
}

export const BOARD_SHAPES: BoardShape[] = ["square", "hex", "triangle"];

/** Human-facing label for a size step, e.g. "9×9" / "4 rings" / "12 rows". */
export function sizeLabel(shape: BoardShape, size: BoardSize): string {
  const s = clampSize(size);
  if (shape === "square") return `${SQUARE_N[s]}×${SQUARE_N[s]}`;
  if (shape === "triangle") return `${TRI_ROWS[s]} rows`;
  return HEX_TRIM[s] > 0 ? `~${HEX_RINGS[s]} rings` : `${HEX_RINGS[s]} rings`;
}

/**
 * Adjacency list in world space, cached per board.
 *
 * Hunt mode needs snakes to crawl one *physical* cell at a time, which is not
 * the same as one index step: consecutive indices are neighbours along the play
 * path, but a snake stalking sideways must be able to cross between rows/rings.
 * Neighbours are therefore any cells within 1.5x the tightest cell spacing,
 * which resolves to the natural 4/6/3-way adjacency of each board shape.
 */
const neighborCache = new Map<string, number[][]>();

export function cellNeighbors(def: BoardDef, idx: number): number[] {
  const key = `${def.shape}:${def.size}`;
  let table = neighborCache.get(key);
  if (!table) {
    const n = def.cells.length;
    const dist = (a: CellPos, b: CellPos) => Math.hypot(a.x - b.x, a.z - b.z);
    let minStep = Infinity;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = dist(def.cells[i], def.cells[j]);
        if (d < minStep) minStep = d;
      }
    }
    const limit = minStep * 1.5;
    table = Array.from({ length: n }, () => [] as number[]);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (dist(def.cells[i], def.cells[j]) <= limit) {
          table[i].push(j);
          table[j].push(i);
        }
      }
    }
    neighborCache.set(key, table);
  }
  return table[idx] ?? [];
}

/** Nearest cell index to a world point. */
export function nearestCell(def: BoardDef, x: number, z: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < def.cells.length; i++) {
    const c = def.cells[i];
    const d = (c.x - x) * (c.x - x) + (c.z - z) * (c.z - z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

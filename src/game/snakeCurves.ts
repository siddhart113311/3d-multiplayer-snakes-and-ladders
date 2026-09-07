// Deterministic snake body curve generation — every client renders identical
// serpents because control points are seeded by board + snake id + endpoints.

import * as THREE from "three";
import { BoardDef } from "./boards";
import { Snake } from "./engine";
import { hashStr, mulberry32 } from "./rng";

export const CELL_Y = 0.17; // top surface of a cell
export const TOKEN_Y = CELL_Y + 0.02;

export function cellWorld(def: BoardDef, idx: number, y = TOKEN_Y): THREE.Vector3 {
  if (idx < 0) return new THREE.Vector3(def.start.x, 0.02, def.start.z);
  const c = def.cells[Math.min(idx, def.last)];
  return new THREE.Vector3(c.x, y, c.z);
}

export interface SnakeCurve {
  curve: THREE.CatmullRomCurve3;
  points: THREE.Vector3[];
  length: number;
  headPos: THREE.Vector3;
  tailPos: THREE.Vector3;
  seed: number;
}

export function buildSnakeCurve(def: BoardDef, snake: Snake): SnakeCurve {
  const seed = hashStr(`snake:${def.shape}:${snake.id}:${snake.head}:${snake.tail}`);
  const rng = mulberry32(seed);

  const head = cellWorld(def, snake.head, 0.5);
  const tail = cellWorld(def, snake.tail, 0.16);

  const main = new THREE.Vector3().subVectors(tail, head);
  main.y = 0;
  const dist = Math.max(0.001, main.length());
  const perp = new THREE.Vector3(-main.z, 0, main.x).normalize();

  const waves = 1.6 + rng() * 1.6;
  const phase = rng() * Math.PI * 2;
  const amp = Math.min(1.0, dist * 0.16) * (0.75 + rng() * 0.5);

  const nCtl = Math.max(5, Math.min(13, Math.round(dist * 1.15)));
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= nCtl; i++) {
    const t = i / nCtl;
    const base = new THREE.Vector3().lerpVectors(head, tail, t);
    const lateral = Math.sin(t * Math.PI * waves + phase) * amp * (1 - t * 0.35);
    base.addScaledVector(perp, lateral);
    // head raised, body hugging the board, gentle breathing arc
    const lift = t < 0.14 ? (1 - t / 0.14) * 0.34 : 0;
    base.y = 0.16 + lift + Math.sin(t * Math.PI) * 0.1;
    points.push(base);
  }
  // pin exact endpoints
  points[0] = head.clone();
  points[0].y = 0.5;
  points[points.length - 1] = tail.clone();
  points[points.length - 1].y = 0.14;

  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal", 0.6);
  return { curve, points, length: dist, headPos: head, tailPos: tail, seed };
}

export const SNAKE_PALETTE = [
  { body: "#3ddc84", belly: "#0d5c3f", accent: "#b6ff6b" },
  { body: "#ff5d8f", belly: "#7a1647", accent: "#ffd166" },
  { body: "#8b5cf6", belly: "#3b1b8a", accent: "#6ee7ff" },
  { body: "#f59e0b", belly: "#8a4b0b", accent: "#45f3ff" },
  { body: "#22d3ee", belly: "#0a5b70", accent: "#fef08a" },
  { body: "#f43f5e", belly: "#701a2d", accent: "#a3e635" },
];

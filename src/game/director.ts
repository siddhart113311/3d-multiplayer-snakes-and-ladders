// The Director: converts authoritative server events into sequential,
// butter-smooth 3D choreographies (tween-based, ref-driven, 60fps friendly).

import * as THREE from "three";
import { BoardDef } from "./boards";
import { GameEvent, Player } from "./engine";
import { buildSnakeCurve, cellWorld, CELL_Y } from "./snakeCurves";
import { sfx } from "./sounds";

export interface TokenVisual {
  x: number;
  y: number;
  z: number;
  scale: number;
  squash: number; // 1 = normal, <1 = squashed
  visible: boolean;
  bobSeed: number;
}

export interface SnakeVisual {
  curve: THREE.CatmullRomCurve3;
  version: number;
  mouth: number; // 0 closed … 1 wide open
  /** t = position along the body (0 head → 1 tail), amp = swell strength 0..1 */
  bulge: { t: number; active: boolean; amp: number };
}

export interface Bridge {
  def: BoardDef;
  tokens: Map<string, TokenVisual>;
  snakes: Map<number, SnakeVisual>;
  shake: { amp: number };
  burst: ((pos: THREE.Vector3, color: string, count?: number, speed?: number) => void) | null;
  onWin: ((playerId: string) => void) | null;
  onIdle: (() => void) | null;
}

type Tween = {
  elapsed: number;
  dur: number;
  fn: (t: number) => void;
  resolve: () => void;
};

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeIn = (t: number) => t * t;

function sampleCurve(curve: THREE.CatmullRomCurve3, n: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) pts.push(curve.getPoint(i / n));
  return pts;
}

export class Director {
  bridge: Bridge;
  private queue: Array<() => Promise<void>> = [];
  private tweens: Tween[] = [];
  private running = false;
  /** raised when a restart happened; page resyncs visuals */
  needsResync = false;

  constructor(bridge: Bridge) {
    this.bridge = bridge;
  }

  get busy(): boolean {
    return this.running || this.tweens.length > 0;
  }

  private tween(dur: number, fn: (t: number) => void): Promise<void> {
    return new Promise((resolve) => {
      this.tweens.push({ elapsed: 0, dur, fn, resolve });
    });
  }

  tick(dt: number) {
    const done: Tween[] = [];
    for (const tw of this.tweens) {
      tw.elapsed += dt;
      const t = Math.min(1, tw.elapsed / tw.dur);
      tw.fn(t);
      if (t >= 1) done.push(tw);
    }
    if (done.length) {
      this.tweens = this.tweens.filter((t) => !done.includes(t));
      for (const d of done) d.resolve();
    }
    if (!this.running && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.running = true;
      void job().then(() => {
        this.running = false;
        if (this.queue.length === 0 && this.tweens.length === 0) {
          this.bridge.onIdle?.();
        }
      });
    }
  }

  shake(amp: number) {
    this.bridge.shake.amp = Math.max(this.bridge.shake.amp, amp);
  }

  burstCell(idx: number, color: string, count = 26, speed = 2.6) {
    const p = cellWorld(this.bridge.def, idx, CELL_Y + 0.25);
    this.bridge.burst?.(p, color, count, speed);
  }

  private token(pid: string): TokenVisual {
    let t = this.bridge.tokens.get(pid);
    if (!t) {
      t = { x: 0, y: 0, z: 0, scale: 1, squash: 1, visible: true, bobSeed: Math.random() * 10 };
      this.bridge.tokens.set(pid, t);
    }
    return t;
  }

  private snake(id: number): SnakeVisual | undefined {
    return this.bridge.snakes.get(id);
  }

  /** hard-reset token positions from player list (first load / resync) */
  snap(players: Array<Pick<Player, "id" | "pos">>) {
    for (const p of players) {
      const v = cellWorld(this.bridge.def, p.pos);
      const t = this.token(p.id);
      t.x = v.x;
      t.y = v.y;
      t.z = v.z;
      t.scale = 1;
      t.squash = 1;
      t.visible = true;
    }
  }

  enqueue(events: GameEvent[], players: Array<{ id: string; color: string }>) {
    const colorOf = (pid: string) => players.find((p) => p.id === pid)?.color ?? "#ffffff";
    for (const ev of events) {
      switch (ev.type) {
        case "roll":
          this.queue.push(async () => {
            sfx.diceRoll();
            await this.tween(0.65, () => {});
            sfx.diceLand(ev.dice);
          });
          break;
        case "hop":
          this.queue.push(() => this.animHop(ev.playerId, ev.path, colorOf(ev.playerId)));
          break;
        case "ladder":
          this.queue.push(() => this.animLadder(ev.playerId, ev.from, ev.to, colorOf(ev.playerId)));
          break;
        case "snakeBite":
          this.queue.push(() =>
            ev.gulp
              ? this.animGulp(ev.playerId, ev.snakeId, ev.from, ev.to, colorOf(ev.playerId), 0.2)
              : this.animSlide(ev.playerId, ev.snakeId, ev.to, colorOf(ev.playerId))
          );
          break;
        case "snakeShift":
          this.queue.push(() => this.animShift(ev));
          break;
        case "win":
          this.queue.push(async () => {
            sfx.win();
            this.shake(0.35);
            const p = cellWorld(this.bridge.def, this.bridge.def.last, CELL_Y + 0.5);
            this.bridge.burst?.(p, "#fbbf24", 90, 4.2);
            this.bridge.burst?.(p, "#ffffff", 40, 3.2);
            this.bridge.onWin?.(ev.playerId);
            await this.tween(0.8, () => {});
          });
          break;
        case "restart":
          this.queue.push(async () => {
            this.needsResync = true;
            await this.tween(0.1, () => {});
          });
          break;
        case "start":
          break;
      }
    }
  }

  private async animHop(pid: string, path: number[], color: string) {
    const tk = this.token(pid);
    if (path.length === 0) return;
    for (let i = 0; i < path.length; i++) {
      const from = new THREE.Vector3(tk.x, tk.y, tk.z);
      const to = cellWorld(this.bridge.def, path[i]);
      const peak = 0.5;
      sfx.hop(i);
      await this.tween(0.16, (t) => {
        const e = easeInOut(t);
        tk.x = from.x + (to.x - from.x) * e;
        tk.z = from.z + (to.z - from.z) * e;
        tk.y = from.y + (to.y - from.y) * e + Math.sin(t * Math.PI) * peak;
        tk.squash = 1 - Math.sin(t * Math.PI) * 0.12;
      });
    }
    sfx.land();
    this.shake(0.06);
    const land = cellWorld(this.bridge.def, path[path.length - 1], CELL_Y + 0.15);
    this.bridge.burst?.(land, color, 12, 1.6);
    await this.tween(0.16, (t) => {
      tk.squash = 0.72 + 0.28 * easeOut(t);
    });
  }

  private async animLadder(pid: string, fromIdx: number, toIdx: number, color: string) {
    const tk = this.token(pid);
    sfx.ladder();
    const a = cellWorld(this.bridge.def, fromIdx, CELL_Y + 0.1);
    const b = cellWorld(this.bridge.def, toIdx, CELL_Y + 0.1);
    const climbH = 0.7 + a.distanceTo(b) * 0.12;
    const top = b.clone();
    top.y += climbH;
    const start = a.clone();
    const mid = start.clone().lerp(top, 0.5);
    const perp = new THREE.Vector3(-(top.z - start.z), 0, top.x - start.x).normalize();
    // climb
    await this.tween(0.62, (t) => {
      const e = easeInOut(t);
      const p = start.clone().lerp(top, e);
      const zig = Math.sin(e * Math.PI * 6) * 0.06;
      p.addScaledVector(perp, zig);
      tk.x = p.x;
      tk.y = p.y;
      tk.z = p.z;
      tk.squash = 1 + Math.sin(e * Math.PI * 6) * 0.06;
    });
    this.bridge.burst?.(top, "#fbbf24", 18, 2);
    // arc down onto the destination cell
    const from = new THREE.Vector3(tk.x, tk.y, tk.z);
    await this.tween(0.24, (t) => {
      const e = easeOut(t);
      tk.x = from.x + (b.x - from.x) * e;
      tk.z = from.z + (b.z - from.z) * e;
      tk.y = from.y + (b.y - from.y) * e + Math.sin(t * Math.PI) * 0.35;
    });
    sfx.land();
    this.shake(0.05);
    tk.squash = 0.8;
    await this.tween(0.14, (t) => {
      tk.squash = 0.8 + 0.2 * easeOut(t);
    });
    void mid;
    void color;
  }

  private async animSlide(pid: string, snakeId: number, toIdx: number, color: string) {
    const tk = this.token(pid);
    const sn = this.snake(snakeId);
    if (!sn) {
      const p = cellWorld(this.bridge.def, toIdx);
      tk.x = p.x;
      tk.y = p.y;
      tk.z = p.z;
      return;
    }
    sfx.hiss();
    await this.tween(0.18, (t) => {
      sn.mouth = t;
    });
    sfx.slideWhistle();
    await this.tween(0.85, (t) => {
      const e = easeInOut(t);
      const p = sn.curve.getPoint(e);
      tk.x = p.x;
      tk.y = p.y + 0.16;
      tk.z = p.z;
      tk.scale = 1 - e * 0.15;
    });
    await this.tween(0.12, (t) => {
      sn.mouth = 1 - t;
      tk.scale = 0.85 + 0.15 * t;
    });
    const rest = cellWorld(this.bridge.def, toIdx);
    tk.x = rest.x;
    tk.y = rest.y;
    tk.z = rest.z;
    sfx.shakeThud();
    this.shake(0.18);
    this.burstCell(toIdx, color, 20, 2.2);
  }

  /** Full gulping choreography: approach → mouth flare → swallow → bulge travel → pop at tail. */
  private async animGulp(pid: string, snakeId: number, fromIdx: number, toIdx: number, color: string, approach = 0.26) {
    const tk = this.token(pid);
    const sn = this.snake(snakeId);
    const rest = cellWorld(this.bridge.def, toIdx);
    if (!sn) {
      tk.x = rest.x;
      tk.y = rest.y;
      tk.z = rest.z;
      return;
    }
    const head = sn.curve.getPoint(0);

    // anticipation: mouth opens, snake hisses
    sfx.hiss(0.6);
    await this.tween(0.22, (t) => {
      sn.mouth = easeOut(t);
    });

    // token gets sucked toward the jaws
    const from = new THREE.Vector3(tk.x, tk.y, tk.z);
    void fromIdx;
    sfx.gulp();
    await this.tween(approach, (t) => {
      const e = easeIn(t);
      tk.x = from.x + (head.x - from.x) * e;
      tk.z = from.z + (head.z - from.z) * e;
      tk.y = from.y + (head.y + 0.05 - from.y) * e + Math.sin(t * Math.PI) * 0.25;
    });

    // Swallow: as the token shrinks into the throat the bulge simultaneously
    // swells at the head, so the mass visibly transfers into the body rather
    // than popping in from nowhere.
    sn.bulge = { t: 0.015, active: true, amp: 0 };
    await this.tween(0.26, (t) => {
      const e = easeInOut(t);
      tk.scale = 1 - e * 0.96;
      tk.y = head.y + 0.05 - e * 0.06;
      sn.mouth = 1 - e * 0.45;
      sn.bulge = { t: 0.015 + e * 0.05, active: true, amp: e };
    });
    tk.visible = false;
    tk.scale = 1;
    this.shake(0.2);

    // Peristalsis: the lump travels head → tail with a gentle wave, and the
    // jaw closes behind it.
    sfx.bulgeTravel();
    await this.tween(1.05, (t) => {
      const e = easeInOut(t);
      const pos = 0.065 + e * 0.885;
      // subtle squeeze pulses as the body works the lump along
      const pulse = 0.88 + Math.sin(t * Math.PI * 5) * 0.12;
      sn.bulge = { t: pos, active: true, amp: pulse };
      sn.mouth = Math.max(0, 0.55 * (1 - t * 2.4));
    });

    // Ease the swell away right at the tail tip as the token emerges.
    await this.tween(0.16, (t) => {
      sn.bulge = { t: 0.95 + t * 0.04, active: true, amp: 1 - easeIn(t) };
    });
    sn.bulge = { t: 0, active: false, amp: 0 };
    sn.mouth = 0;

    // deposit at the tail
    tk.x = rest.x;
    tk.y = rest.y;
    tk.z = rest.z;
    tk.visible = true;
    tk.scale = 0.2;
    sfx.pop();
    this.shake(0.16);
    this.bundleBurst(rest, color);
    await this.tween(0.24, (t) => {
      tk.scale = 0.2 + 0.8 * easeOut(t);
      tk.squash = 1 - Math.sin(t * Math.PI) * 0.22;
    });
    tk.squash = 1;
  }

  private bundleBurst(p: THREE.Vector3, color: string) {
    this.bridge.burst?.(p, color, 24, 2.6);
    this.bridge.burst?.(p, "#ffffff", 10, 1.6);
  }

  /** Fire-mode: a snake leaves its spot and slithers across the board. */
  private async animShift(ev: Extract<GameEvent, { type: "snakeShift" }>) {
    const sn = this.snake(ev.snake.id);
    if (!sn) return;
    sfx.fireAlarm();
    await this.tween(0.18, () => {});
    sfx.hiss(1.2);
    this.shake(0.12);

    const fromPts = sampleCurve(sn.curve, 26);
    const target = buildSnakeCurve(this.bridge.def, ev.snake);
    const toPts = sampleCurve(target.curve, 26);
    const K = fromPts.length;

    await this.tween(1.4, (t) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < K; i++) {
        // staggered whip: tail points lag behind the head
        const lag = (i / K) * 0.45;
        const local = Math.min(1, Math.max(0, (t - lag) / (1 - 0.45)));
        const e = easeInOut(local);
        const p = new THREE.Vector3().lerpVectors(fromPts[i], toPts[i], e);
        p.y += Math.sin(local * Math.PI) * 0.35; // body lifts off while moving
        pts.push(p);
      }
      sn.curve = new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.5);
      sn.version += 1;
      sn.mouth = Math.sin(t * Math.PI) * 0.6;
    });
    sn.curve = target.curve;
    sn.version += 1;
    sn.mouth = 0;

    // gulp any players caught on the corridor, one dramatic snack at a time
    for (const g of ev.gulped) {
      await this.animGulpLate(g.playerId, ev.snake.id, g.from, g.to);
    }
  }

  /** Gulped during a shift: token flies into the new head position. */
  private async animGulpLate(pid: string, snakeId: number, fromIdx: number, toIdx: number) {
    const tk = this.token(pid);
    const sn = this.snake(snakeId);
    if (!sn) return;
    const from = cellWorld(this.bridge.def, fromIdx);
    tk.x = from.x;
    tk.y = from.y;
    tk.z = from.z;
    const player = this.bridge.tokens.get(pid);
    void player;
    const color = "#ffb4b4";
    await this.animGulp(pid, snakeId, fromIdx, toIdx, color, 0.3);
  }
}

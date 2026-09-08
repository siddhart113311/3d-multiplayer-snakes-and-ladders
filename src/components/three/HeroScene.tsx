"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BoardDef, BoardShape, BoardSize, getBoard } from "@/game/boards";
import type { Ladder, Snake } from "@/game/engine";
import type { SnakeVisual, TokenVisual } from "@/game/director";
import { buildSnakeCurve, cellWorld, TOKEN_Y } from "@/game/snakeCurves";
import { fitCameraDistance, getBreakpoint } from "@/game/viewport";
import BoardMesh from "./BoardMesh";
import LaddersMesh from "./LadderMesh";
import SnakeMesh from "./SnakeMesh";
import TokenMesh from "./TokenMesh";
import Particles, { type ParticlesHandle } from "./Particles";

/** Small board keeps the menu light while still reading as a real game. */
const HERO_SIZE: BoardSize = 2;
const HOP = 0.15; // seconds per cell hop

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeIn = (t: number) => t * t;

/**
 * Hand-authored hazards (rather than the random generator) so the loop always
 * has exactly one ladder to climb and one snake to be swallowed by.
 */
function heroFeatures(def: BoardDef): { ladder: Ladder; snake: Snake } {
  const last = def.last;
  return {
    ladder: { bottom: Math.max(2, Math.round(last * 0.14)), top: Math.round(last * 0.54) },
    snake: { id: 0, head: Math.round(last * 0.84), tail: Math.round(last * 0.28) },
  };
}

interface Timeline {
  walk1: number;
  climb: number;
  walk2: number;
  approach: number;
  swallow: number;
  travel: number;
  emerge: number;
  rest: number;
  total: number;
  path1: number[];
  path2: number[];
}

function buildTimeline(ladder: Ladder, snake: Snake): Timeline {
  const path1: number[] = [];
  for (let i = 0; i <= ladder.bottom; i++) path1.push(i);
  const path2: number[] = [];
  for (let i = ladder.top + 1; i <= snake.head; i++) path2.push(i);

  const walk1 = (path1.length + 1) * HOP; // +1 for the leap off the start pad
  const climb = 0.95;
  const walk2 = Math.max(1, path2.length) * HOP;
  const approach = 0.34;
  const swallow = 0.3;
  const travel = 1.35;
  const emerge = 0.28;
  const rest = 1.15;
  return {
    walk1,
    climb,
    walk2,
    approach,
    swallow,
    travel,
    emerge,
    rest,
    total: walk1 + climb + walk2 + approach + swallow + travel + emerge + rest,
    path1,
    path2,
  };
}

/** Hop along a list of cells, arcing between each one. */
function hopAlong(def: BoardDef, from: number, path: number[], u: number, out: THREE.Vector3): number {
  const steps = path.length;
  const raw = Math.min(0.9999, Math.max(0, u)) * steps;
  const i = Math.floor(raw);
  const f = raw - i;
  const a = cellWorld(def, i === 0 ? from : path[i - 1]);
  const b = cellWorld(def, path[Math.min(i, steps - 1)]);
  const e = easeInOut(f);
  out.set(a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e + Math.sin(f * Math.PI) * 0.42, a.z + (b.z - a.z) * e);
  return i;
}

function HeroAnimation({
  def,
  ladder,
  snake,
  token,
  snakeVis,
  particles,
  paused,
}: {
  def: BoardDef;
  ladder: Ladder;
  snake: Snake;
  token: TokenVisual;
  snakeVis: SnakeVisual;
  particles: React.RefObject<ParticlesHandle | null>;
  paused: boolean;
}) {
  const clock = useRef(0);
  const lastHop = useRef(-1);
  const tl = useMemo(() => buildTimeline(ladder, snake), [ladder, snake]);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, dt) => {
    if (paused) return;
    clock.current = (clock.current + Math.min(dt, 0.05)) % tl.total;
    let t = clock.current;

    // defaults for this frame
    token.visible = true;
    token.scale = 1;
    token.squash = 1;
    snakeVis.mouth = 0;
    snakeVis.bulge = { t: 0, active: false, amp: 0 };

    // 1. hop from the start pad to the foot of the ladder
    if (t < tl.walk1) {
      const idx = hopAlong(def, -1, tl.path1, t / tl.walk1, tmp);
      token.x = tmp.x;
      token.y = tmp.y;
      token.z = tmp.z;
      if (idx !== lastHop.current) {
        lastHop.current = idx;
        if (idx % 3 === 0) particles.current?.burst(cellWorld(def, tl.path1[idx] ?? 0), "#38bdf8", 8, 1.4);
      }
      return;
    }
    t -= tl.walk1;

    // 2. climb the ladder
    if (t < tl.climb) {
      const u = t / tl.climb;
      const e = easeInOut(u);
      const a = cellWorld(def, ladder.bottom);
      const b = cellWorld(def, ladder.top);
      const rise = 0.75 + a.distanceTo(b) * 0.1;
      token.x = a.x + (b.x - a.x) * e;
      token.z = a.z + (b.z - a.z) * e;
      token.y = a.y + (b.y - a.y) * e + Math.sin(e * Math.PI) * rise;
      token.squash = 1 + Math.sin(e * Math.PI * 6) * 0.06;
      if (lastHop.current !== -2 && u > 0.94) {
        lastHop.current = -2;
        particles.current?.burst(cellWorld(def, ladder.top), "#fbbf24", 20, 2.2);
      }
      return;
    }
    t -= tl.climb;

    // 3. hop onward into the snake's jaws
    if (t < tl.walk2) {
      const idx = hopAlong(def, ladder.top, tl.path2, t / tl.walk2, tmp);
      token.x = tmp.x;
      token.y = tmp.y;
      token.z = tmp.z;
      lastHop.current = idx;
      return;
    }
    t -= tl.walk2;

    const head = snakeVis.curve.getPointAt(0);
    const tail = cellWorld(def, snake.tail);

    // 4. the jaws open and the token is drawn in
    if (t < tl.approach) {
      const u = t / tl.approach;
      const a = cellWorld(def, snake.head);
      const e = easeIn(u);
      snakeVis.mouth = easeOut(Math.min(1, u * 1.6));
      token.x = a.x + (head.x - a.x) * e;
      token.z = a.z + (head.z - a.z) * e;
      token.y = a.y + (head.y + 0.04 - a.y) * e + Math.sin(u * Math.PI) * 0.22;
      return;
    }
    t -= tl.approach;

    // 5. swallowed — the token shrinks as the bulge swells at the head
    if (t < tl.swallow) {
      const u = easeInOut(t / tl.swallow);
      token.x = head.x;
      token.z = head.z;
      token.y = head.y + 0.04 - u * 0.05;
      token.scale = 1 - u * 0.96;
      snakeVis.mouth = 1 - u * 0.45;
      snakeVis.bulge = { t: 0.015 + u * 0.05, active: true, amp: u };
      return;
    }
    t -= tl.swallow;

    // 6. the lump travels down the body
    if (t < tl.travel) {
      const u = t / tl.travel;
      const e = easeInOut(u);
      token.visible = false;
      snakeVis.mouth = Math.max(0, 0.55 * (1 - u * 2.4));
      snakeVis.bulge = { t: 0.065 + e * 0.885, active: true, amp: 0.88 + Math.sin(u * Math.PI * 5) * 0.12 };
      lastHop.current = -3;
      return;
    }
    t -= tl.travel;

    // 7. spat out at the tail
    if (t < tl.emerge) {
      const u = t / tl.emerge;
      snakeVis.bulge = { t: 0.95 + u * 0.04, active: true, amp: 1 - easeIn(u) };
      token.x = tail.x;
      token.y = tail.y;
      token.z = tail.z;
      token.scale = 0.2 + 0.8 * easeOut(u);
      token.squash = 1 - Math.sin(u * Math.PI) * 0.22;
      if (lastHop.current === -3) {
        lastHop.current = -4;
        particles.current?.burst(tail, "#ff4d5e", 22, 2.4);
        particles.current?.burst(tail, "#ffffff", 10, 1.6);
      }
      return;
    }

    // 8. a beat at the tail before looping
    token.x = tail.x;
    token.y = tail.y;
    token.z = tail.z;
    lastHop.current = -1;
  });

  return null;
}

/** Slowly orbits, always framed so the whole board is visible in the panel. */
function HeroCamera({ def, paused }: { def: BoardDef; paused: boolean }) {
  const { camera, size } = useThree();
  const azimuth = useRef(0.7);
  const target = useMemo(() => new THREE.Vector3(def.center.x, -0.1, def.center.z), [def]);

  const distance = useMemo(() => {
    const persp = camera as THREE.PerspectiveCamera;
    return fitCameraDistance({
      radius: def.radius * 1.16,
      fovY: persp.isPerspectiveCamera ? persp.fov : 40,
      aspect: size.width / Math.max(1, size.height),
      margin: 1.04,
      insetX: 0.02,
      insetY: 0.06,
    });
  }, [camera, def.radius, size.width, size.height]);

  useFrame((state, dt) => {
    if (!paused) azimuth.current += Math.min(dt, 0.05) * 0.17;
    const a = azimuth.current;
    // constant elevation, orbiting azimuth, at the exact fitted distance
    const dir = new THREE.Vector3(Math.sin(a) * 0.62, 0.74, Math.cos(a) * 0.62).normalize();
    state.camera.position.copy(target).addScaledVector(dir, distance);
    state.camera.lookAt(target);
  });

  return null;
}

export default function HeroScene({ shape, fire }: { shape: BoardShape; fire: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const particles = useRef<ParticlesHandle>(null);
  const [onScreen, setOnScreen] = useState(true);
  const [reduced, setReduced] = useState(false);

  const def = useMemo(() => getBoard(shape, HERO_SIZE), [shape]);
  const { ladder, snake } = useMemo(() => heroFeatures(def), [def]);
  const ladders = useMemo(() => [ladder], [ladder]);

  const token = useMemo<TokenVisual>(
    () => ({ x: def.start.x, y: TOKEN_Y, z: def.start.z, scale: 1, squash: 1, visible: true, bobSeed: 2 }),
    [def]
  );
  const snakeVis = useMemo<SnakeVisual>(
    () => ({ curve: buildSnakeCurve(def, snake).curve, version: 0, mouth: 0, bulge: { t: 0, active: false, amp: 0 } }),
    [def, snake]
  );

  // Honour reduced-motion, and stop rendering when scrolled away or backgrounded.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);

    const el = wrapRef.current;
    const io = el
      ? new IntersectionObserver((entries) => setOnScreen(entries[0]?.isIntersecting ?? true), { threshold: 0.05 })
      : null;
    if (el && io) io.observe(el);

    const onVisibility = () => setOnScreen(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      mq.removeEventListener("change", sync);
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const paused = reduced || !onScreen;
  const quality = useMemo(() => {
    if (typeof window === "undefined") return { phone: false, dpr: 1.5, textureSize: 2048 };
    const bp = getBreakpoint(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
    return {
      phone: bp.isPhone,
      dpr: bp.isPhone ? Math.min(bp.dprCap, 1.4) : Math.min(bp.dprCap, 1.7),
      textureSize: bp.isPhone ? 1280 : 2048,
    };
  }, []);
  const dpr = useMemo<[number, number]>(() => [1, quality.dpr], [quality.dpr]);

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <Canvas
        dpr={dpr}
        frameloop={paused ? "demand" : "always"}
        camera={{ position: [0, def.radius * 1.6, def.radius * 1.6], fov: 40, near: 0.1, far: 400 }}
        gl={{ antialias: !quality.phone, powerPreference: "high-performance", alpha: false, failIfMajorPerformanceCaveat: false }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.12;
        }}
      >
        <color attach="background" args={["#060b18"]} />
        <hemisphereLight args={["#9db8e8", "#0a0f1c", 0.7]} />
        <directionalLight position={[8, 16, 7]} intensity={1.5} color="#eaf2ff" />
        <directionalLight position={[-9, 10, -6]} intensity={0.45} color="#7dd3fc" />
        <pointLight position={[def.center.x, 4.5, def.center.z]} intensity={14} distance={def.radius * 3} color="#22c55e" />

        <BoardMesh def={def} activeCell={-1} textureSize={quality.textureSize} />
        <LaddersMesh def={def} ladders={ladders} />
        <SnakeMesh visual={snakeVis} paletteIdx={0} charging={fire} mobileQuality={quality.phone} />
        <TokenMesh visual={token} color="#ff4d5e" active dimmed={false} />
        <Particles ref={particles} />

        <HeroAnimation
          def={def}
          ladder={ladder}
          snake={snake}
          token={token}
          snakeVis={snakeVis}
          particles={particles}
          paused={paused}
        />
        <HeroCamera def={def} paused={paused} />
      </Canvas>
    </div>
  );
}

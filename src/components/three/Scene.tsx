"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { BoardDef } from "@/game/boards";
import { Ladder, Snake } from "@/game/engine";
import { SnakeVisual, TokenVisual } from "@/game/director";
import { getBreakpoint } from "@/game/viewport";
import BoardMesh from "./BoardMesh";
import SnakeMesh from "./SnakeMesh";
import LaddersMesh from "./LadderMesh";
import TokenMesh from "./TokenMesh";
import Particles, { ParticlesHandle } from "./Particles";
import CameraRig from "./CameraRig";

export interface ScenePlayer {
  id: string;
  color: string;
  finished: boolean;
}

export default function Scene({
  def,
  ladders,
  snakes,
  snakeVisuals,
  players,
  tokenVisuals,
  activePlayerId,
  activeCell,
  charging,
  shake,
  onParticlesReady,
  preview = false,
  rotateSignal,
  flatView = false,
}: {
  def: BoardDef;
  ladders: Ladder[];
  snakes: Snake[];
  snakeVisuals: Map<number, SnakeVisual>;
  players: ScenePlayer[];
  tokenVisuals: Map<string, TokenVisual>;
  activePlayerId?: string;
  activeCell?: number;
  charging: boolean;
  shake: { amp: number };
  onParticlesReady: (h: ParticlesHandle | null) => void;
  preview?: boolean;
  rotateSignal?: React.MutableRefObject<{ az: number; pol: number }>;
  flatView?: boolean;
}) {
  const particlesRef = useRef<ParticlesHandle>(null);
  // Rough starting pose; CameraRig fits it to the real viewport on mount.
  const camPos = useMemo(() => {
    const d = def.radius * (preview ? 2.0 : 1.85);
    return [def.center.x + d * 0.16, d * 0.95, def.center.z + d * 0.82] as [number, number, number];
  }, [def, preview]);

  // Cap the pixel ratio per device class — a 3x phone display would otherwise
  // rasterise ~9x the pixels of a 1x screen and drop well below 60fps.
  const dprCap = useMemo(() => {
    if (typeof window === "undefined") return 1.8;
    return getBreakpoint(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1).dprCap;
  }, []);

  useEffect(() => {
    // children mount before this effect — the particles handle is guaranteed
    if (particlesRef.current) onParticlesReady(particlesRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Canvas
      dpr={[1, dprCap]}
      resize={{ scroll: false, debounce: { scroll: 0, resize: 80 } }}
      camera={{ position: camPos, fov: 42, near: 0.1, far: 220 }}
      gl={{ antialias: true, powerPreference: "high-performance", alpha: false }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.12;
      }}
    >
      <color attach="background" args={["#060b18"]} />
      {/* overhead camera sits far back, so 3D fog distances would grey out the board */}
      <fog attach="fog" args={["#060b18", def.radius * (flatView ? 4.2 : 2.6), def.radius * (flatView ? 9 : 5.4)]} />
      <hemisphereLight args={["#9db8e8", "#0a0f1c", 0.65]} />
      <directionalLight position={[8, 16, 7]} intensity={1.5} color="#eaf2ff" />
      <directionalLight position={[-9, 10, -6]} intensity={0.4} color="#7dd3fc" />
      <pointLight position={[def.center.x, 5, def.center.z]} intensity={18} distance={def.radius * 3} color="#22c55e" />

      <Suspense fallback={null}>
        <BoardMesh def={def} activeCell={activeCell ?? -1} flatView={flatView} />
        <LaddersMesh def={def} ladders={ladders} flatView={flatView} />
        {snakes.map((s) => {
          const v = snakeVisuals.get(s.id);
          return v ? <SnakeMesh key={`${s.id}:${s.head}:${s.tail}`} visual={v} paletteIdx={s.id} charging={charging} /> : null;
        })}
        {players.map((p) => {
          const tv = tokenVisuals.get(p.id);
          return tv ? (
            <TokenMesh key={p.id} visual={tv} color={p.color} active={p.id === activePlayerId} dimmed={p.finished} />
          ) : null;
        })}
        <Particles ref={particlesRef} />
      </Suspense>

      {/* floating dust motes (pure 3D atmosphere — noise from above) */}
      {!flatView && <Motes def={def} />}
      <CameraRig def={def} shake={shake} preview={preview} rotateSignal={rotateSignal} flat={flatView} />
    </Canvas>
  );
}

function Motes({ def }: { def: BoardDef }) {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const count = 90;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = def.radius * (0.6 + Math.random() * 1.5);
      const a = Math.random() * Math.PI * 2;
      arr[i * 3] = def.center.x + Math.cos(a) * r;
      arr[i * 3 + 1] = 0.4 + Math.random() * 5;
      arr[i * 3 + 2] = def.center.z + Math.sin(a) * r;
    }
    return arr;
  }, [def]);

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.06} color="#31518a" transparent opacity={0.7} depthWrite={false} />
    </points>
  );
}

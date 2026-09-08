"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
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
  const profile = useMemo(() => {
    if (typeof window === "undefined") {
      return { ...getBreakpoint(1280, 800, 1.8), textureSize: 2560 };
    }
    const bp = getBreakpoint(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
    return {
      ...bp,
      textureSize: bp.isPhone ? 1536 : bp.isTablet ? 2048 : 2560,
    };
  }, []);
  const [contextLost, setContextLost] = useState(false);

  useEffect(() => {
    // children mount before this effect — the particles handle is guaranteed
    if (particlesRef.current) onParticlesReady(particlesRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="absolute inset-0">
      <Canvas
        dpr={[1, profile.dprCap]}
        fallback={
          <div className="absolute inset-0 flex items-center justify-center bg-[#060b18] p-6 text-center">
            <div className="max-w-xs rounded-3xl border border-amber-400/30 bg-amber-400/10 p-5">
              <p className="text-sm font-black uppercase tracking-wider text-amber-200">3D graphics unavailable</p>
              <p className="mt-2 text-xs leading-relaxed text-white/60">
                Enable hardware acceleration and open Serpentia in the latest Chrome, Safari, Firefox, or Edge.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="mt-4 min-h-11 rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-5 text-xs font-black uppercase tracking-widest text-slate-950"
              >
                Try again
              </button>
            </div>
          </div>
        }
        resize={{ scroll: false, debounce: { scroll: 0, resize: 80 } }}
        camera={{ position: camPos, fov: 42, near: 0.1, far: 400 }}
        gl={{
          antialias: !profile.isPhone,
          powerPreference: "high-performance",
          alpha: false,
          failIfMajorPerformanceCaveat: false,
        }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.12;
        }}
      >
        <color attach="background" args={["#060b18"]} />
        <ResponsiveFog def={def} flat={flatView} />
        <ContextEvents onLost={() => setContextLost(true)} onRestored={() => setContextLost(false)} />
        <hemisphereLight args={["#9db8e8", "#0a0f1c", 0.65]} />
        <directionalLight position={[8, 16, 7]} intensity={1.5} color="#eaf2ff" />
        <directionalLight position={[-9, 10, -6]} intensity={0.4} color="#7dd3fc" />
        <pointLight position={[def.center.x, 5, def.center.z]} intensity={18} distance={def.radius * 3} color="#22c55e" />

        <Suspense fallback={null}>
          <BoardMesh def={def} activeCell={activeCell ?? -1} flatView={flatView} textureSize={profile.textureSize} />
          <LaddersMesh def={def} ladders={ladders} flatView={flatView} />
          {snakes.map((s) => {
            const v = snakeVisuals.get(s.id);
            return v ? (
              <SnakeMesh
                key={`${s.id}:${s.head}:${s.tail}`}
                visual={v}
                paletteIdx={s.id}
                charging={charging}
                mobileQuality={profile.isPhone}
              />
            ) : null;
          })}
          {players.map((p) => {
            const tv = tokenVisuals.get(p.id);
            return tv ? (
              <TokenMesh key={p.id} visual={tv} color={p.color} active={p.id === activePlayerId} dimmed={p.finished} />
            ) : null;
          })}
          <Particles ref={particlesRef} />
        </Suspense>

        {/* Dust is decorative and wastes fill-rate on phone GPUs. */}
        {!flatView && !profile.isPhone && <Motes def={def} />}
        <CameraRig def={def} shake={shake} preview={preview} rotateSignal={rotateSignal} flat={flatView} />
      </Canvas>

      {contextLost && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#060b18]/95 p-6 text-center">
          <div className="max-w-xs rounded-3xl border border-amber-400/30 bg-amber-400/10 p-5 backdrop-blur-md">
            <p className="text-sm font-black uppercase tracking-wider text-amber-200">3D renderer paused</p>
            <p className="mt-2 text-xs leading-relaxed text-white/60">
              Your phone released the graphics context. Close other heavy tabs, then reload the 3D board.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 min-h-11 rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-5 text-xs font-black uppercase tracking-widest text-slate-950"
            >
              Reload 3D
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ResponsiveFog({ def, flat }: { def: BoardDef; flat: boolean }) {
  const { scene, camera } = useThree();
  const fog = useMemo(() => new THREE.Fog("#060b18", 1, 100), []);
  const target = useMemo(() => new THREE.Vector3(def.center.x, 0, def.center.z), [def.center.x, def.center.z]);

  useEffect(() => {
    const previous = scene.fog;
    scene.fog = fog;
    return () => {
      if (scene.fog === fog) scene.fog = previous;
    };
  }, [scene, fog]);

  useFrame(() => {
    const dist = camera.position.distanceTo(target);
    if (flat) {
      // Keep the printed-board view completely clear from overhead.
      fog.near = dist + def.radius * 0.35;
      fog.far = dist + def.radius * 5;
    } else {
      // On portrait phones responsive fitting moves the camera far back. Fog
      // must move with it; fixed radius-based fog made the entire 3D board fully
      // opaque before it reached the camera.
      fog.near = Math.max(0.5, dist - def.radius * 0.2);
      fog.far = dist + def.radius * 4;
    }
  });

  return null;
}

function ContextEvents({ onLost, onRestored }: { onLost: () => void; onRestored: () => void }) {
  const { gl } = useThree();

  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (event: Event) => {
      event.preventDefault();
      onLost();
    };
    const restored = () => onRestored();
    canvas.addEventListener("webglcontextlost", lost, false);
    canvas.addEventListener("webglcontextrestored", restored, false);
    return () => {
      canvas.removeEventListener("webglcontextlost", lost, false);
      canvas.removeEventListener("webglcontextrestored", restored, false);
    };
  }, [gl, onLost, onRestored]);

  return null;
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

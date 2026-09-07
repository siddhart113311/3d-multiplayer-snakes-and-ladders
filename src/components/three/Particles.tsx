"use client";

import { useMemo, useRef, forwardRef, useImperativeHandle } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const MAX = 900;

export interface ParticlesHandle {
  burst: (pos: THREE.Vector3, color: string, count?: number, speed?: number) => void;
}

/** Single pooled GPU point cloud — zero allocation per frame. */
const Particles = forwardRef<ParticlesHandle>(function Particles(_, ref) {
  const pointsRef = useRef<THREE.Points>(null);
  const data = useMemo(() => {
    return {
      pos: new Float32Array(MAX * 3),
      vel: new Float32Array(MAX * 3),
      col: new Float32Array(MAX * 3),
      life: new Float32Array(MAX),
      maxLife: new Float32Array(MAX),
      cursor: 0,
    };
  }, []);

  useImperativeHandle(ref, () => ({
    burst(pos, color, count = 24, speed = 2.5) {
      const c = new THREE.Color(color);
      for (let i = 0; i < count; i++) {
        const idx = data.cursor;
        data.cursor = (data.cursor + 1) % MAX;
        data.pos[idx * 3] = pos.x;
        data.pos[idx * 3 + 1] = pos.y;
        data.pos[idx * 3 + 2] = pos.z;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const sp = speed * (0.4 + Math.random() * 0.9);
        data.vel[idx * 3] = Math.sin(phi) * Math.cos(theta) * sp;
        data.vel[idx * 3 + 1] = Math.abs(Math.cos(phi)) * sp * 1.2;
        data.vel[idx * 3 + 2] = Math.sin(phi) * Math.sin(theta) * sp;
        const jitter = 0.75 + Math.random() * 0.35;
        data.col[idx * 3] = Math.min(1, c.r * jitter);
        data.col[idx * 3 + 1] = Math.min(1, c.g * jitter);
        data.col[idx * 3 + 2] = Math.min(1, c.b * jitter);
        data.life[idx] = 0.001;
        data.maxLife[idx] = 0.5 + Math.random() * 0.6;
      }
    },
  }));

  useFrame((_, dt) => {
    const pts = pointsRef.current;
    if (!pts) return;
    const d = Math.min(dt, 0.05);
    for (let i = 0; i < MAX; i++) {
      if (data.life[i] <= 0) continue;
      data.life[i] += d;
      if (data.life[i] > data.maxLife[i]) {
        data.life[i] = 0;
        data.pos[i * 3 + 1] = -999;
        continue;
      }
      data.vel[i * 3 + 1] -= 5.5 * d; // gravity
      data.pos[i * 3] += data.vel[i * 3] * d;
      data.pos[i * 3 + 1] += data.vel[i * 3 + 1] * d;
      data.pos[i * 3 + 2] += data.vel[i * 3 + 2] * d;
      if (data.pos[i * 3 + 1] < 0.03) {
        data.pos[i * 3 + 1] = 0.03;
        data.vel[i * 3 + 1] *= -0.35;
        data.vel[i * 3] *= 0.7;
        data.vel[i * 3 + 2] *= 0.7;
      }
    }
    const geo = pts.geometry;
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
    posAttr.copyArray(data.pos);
    posAttr.needsUpdate = true;
    const colAttr = geo.getAttribute("color") as THREE.BufferAttribute;
    colAttr.copyArray(data.col);
    colAttr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[data.pos, 3]} />
        <bufferAttribute attach="attributes-color" args={[data.col, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.14} vertexColors transparent opacity={0.95} depthWrite={false} sizeAttenuation blending={THREE.AdditiveBlending} />
    </points>
  );
});

export default Particles;

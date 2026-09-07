"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { TokenVisual } from "@/game/director";

/** Player pawn: glossy capsule with emissive aura ring + blob shadow. */
export default function TokenMesh({
  visual,
  color,
  active,
  dimmed,
}: {
  visual: TokenVisual;
  color: string;
  active: boolean;
  dimmed: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const bodyMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.25, emissive: color, emissiveIntensity: 0.25 }),
    [color]
  );
  const glowMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    [color]
  );

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const t = clock.getElapsedTime();
    g.visible = visual.visible;
    g.position.set(visual.x, visual.y, visual.z + 0);
    const bob = Math.sin(t * 3 + visual.bobSeed) * 0.025;
    g.position.y += Math.max(0, bob) + 0.02;
    g.scale.set(visual.scale * (2 - visual.squash) * 0.5 + visual.scale * 0.5, visual.scale * visual.squash, visual.scale * (2 - visual.squash) * 0.5 + visual.scale * 0.5);
    if (ring.current) {
      const m = ring.current.material as THREE.MeshBasicMaterial;
      m.opacity = dimmed ? 0.25 : active ? 0.65 + Math.abs(Math.sin(t * 4)) * 0.35 : 0.45;
      ring.current.scale.setScalar(active ? 1 + Math.sin(t * 4) * 0.08 : 1);
    }
  });

  return (
    <group ref={group}>
      {/* blob shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <circleGeometry args={[0.26, 20]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      {/* aura ring */}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} material={glowMat}>
        <ringGeometry args={[0.28, 0.38, 24]} />
      </mesh>
      {/* pawn body */}
      <mesh position={[0, 0.16, 0]} material={bodyMat}>
        <cylinderGeometry args={[0.13, 0.22, 0.3, 16]} />
      </mesh>
      <mesh position={[0, 0.42, 0]} material={bodyMat}>
        <sphereGeometry args={[0.16, 16, 12]} />
      </mesh>
      <mesh position={[0, 0.42, 0]}>
        <sphereGeometry args={[0.09, 12, 8]} />
        <meshStandardMaterial color="#ffffff" roughness={0.1} metalness={0.1} emissive="#ffffff" emissiveIntensity={0.15} />
      </mesh>
    </group>
  );
}

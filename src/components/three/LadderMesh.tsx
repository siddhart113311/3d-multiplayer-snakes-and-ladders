"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { BoardDef } from "@/game/boards";
import { Ladder } from "@/game/engine";
import { CELL_Y } from "@/game/snakeCurves";

const UP = new THREE.Vector3(0, 1, 0);

function LadderUnit({ def, ladder, flatView }: { def: BoardDef; ladder: Ladder; flatView: boolean }) {
  const data = useMemo(() => {
    const a = new THREE.Vector3(def.cells[ladder.bottom].x, CELL_Y, def.cells[ladder.bottom].z);
    const flat = new THREE.Vector3(def.cells[ladder.top].x, CELL_Y, def.cells[ladder.top].z);
    const dist = a.distanceTo(flat);
    const b = flat.clone();
    // In 2D the ladder lies flat on the board so it reads as a clean connector.
    b.y += flatView ? 0.02 : 0.7 + dist * 0.12;
    const dir = new THREE.Vector3().subVectors(b, a).normalize();
    const side = new THREE.Vector3().crossVectors(dir, UP);
    if (side.lengthSq() < 0.01) side.set(1, 0, 0);
    side.normalize();
    const railOff = 0.21;
    // Orthonormal frame: X = across the ladder, Y = up the ladder, Z = face normal.
    // A cylinder/box is authored along +Y, so this single quaternion orients both
    // the rails (long axis = dir) and the rungs (long axis = across = side).
    const normal = new THREE.Vector3().crossVectors(side, dir).normalize();
    const frame = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, dir, normal));
    const len = a.distanceTo(b);
    const rungCount = Math.max(2, Math.round(len / 0.36));
    const rungs: THREE.Vector3[] = [];
    for (let i = 1; i <= rungCount; i++) {
      rungs.push(a.clone().addScaledVector(dir, (i / (rungCount + 1)) * len));
    }
    return { a, b, dir, side, frame, len, rungs, railOff, rungSpan: railOff * 2 };
  }, [def, ladder, flatView]);

  const wood = useMemo(() => new THREE.MeshStandardMaterial({ color: "#b45309", roughness: 0.5, metalness: 0.12 }), []);
  const rungMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#f59e0b", roughness: 0.45, metalness: 0.2, emissive: "#7c2d12", emissiveIntensity: 0.15 }), []);

  return (
    <group>
      {/* two side rails running bottom → top */}
      {[1, -1].map((s) => {
        const pos = data.a.clone().lerp(data.b, 0.5).addScaledVector(data.side, data.railOff * s);
        return (
          <mesh key={s} position={pos} quaternion={data.frame} material={wood} castShadow>
            <cylinderGeometry args={[0.055, 0.055, data.len + 0.3, 8]} />
          </mesh>
        );
      })}
      {/* horizontal steps spanning between the rails */}
      {data.rungs.map((p, i) => (
        <group key={i} position={p} quaternion={data.frame}>
          {/* box is authored along +Y, rotate it a quarter turn so it spans +X (across) */}
          <mesh rotation={[0, 0, Math.PI / 2]} material={rungMat}>
            <boxGeometry args={[0.055, data.rungSpan + 0.02, 0.11]} />
          </mesh>
        </group>
      ))}
      {/* golden glow pad at the base */}
      <mesh position={[data.a.x, CELL_Y + 0.01, data.a.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.3, 0.44, 24]} />
        <meshBasicMaterial color="#fbbf24" transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

export default function LaddersMesh({ def, ladders, flatView = false }: { def: BoardDef; ladders: Ladder[]; flatView?: boolean }) {
  return (
    <group>
      {ladders.map((l, i) => (
        <LadderUnit key={`${l.bottom}-${l.top}-${i}`} def={def} ladder={l} flatView={flatView} />
      ))}
    </group>
  );
}

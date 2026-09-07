"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { BoardDef } from "@/game/boards";
import { CELL_Y } from "@/game/snakeCurves";

const CELL_A = "#1c2b47";
const CELL_B = "#14203a";
const START_C = "#0f5132";
const END_C = "#6b4d0f";

/**
 * All cell numbers baked into ONE texture drawn on a single plane.
 * With 225 cells, per-cell text meshes would cost hundreds of draw calls.
 */
function useNumberOverlay(def: BoardDef) {
  return useMemo(() => {
    const R = def.radius;
    const PX = 2560;
    const canvas = document.createElement("canvas");
    canvas.width = PX;
    canvas.height = PX;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, PX, PX);

    const toPx = (x: number, z: number) => ({
      px: ((x - (def.center.x - R)) / (2 * R)) * PX,
      py: ((z - (def.center.z - R)) / (2 * R)) * PX,
    });

    // Usable width differs a lot per shape: a triangle's inscribed circle is far
    // smaller than its cellSize, which is why 3-digit numbers used to overflow.
    const inscribed =
      def.shape === "square"
        ? def.cellSize
        : def.shape === "hex"
          ? (def.cellSize / 2) * Math.sqrt(3) // across the flats
          : def.cellSize / 1.72; // triangle: 2 × inradius
    const inscribedPx = (inscribed / (2 * R)) * PX;
    const maxTextPx = inscribedPx * 0.66;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    def.cells.forEach((c, i) => {
      const { px, py } = toPx(c.x, c.z);
      const label = String(i + 1);
      const isEnd = i === def.last;
      const isStart = i === 0;

      // shrink-to-fit so long labels never bleed into neighbouring cells
      let fontSize = inscribedPx * 0.5;
      ctx.font = `700 ${fontSize}px "Space Grotesk", Arial, sans-serif`;
      const w = ctx.measureText(label).width;
      if (w > maxTextPx) fontSize *= maxTextPx / w;
      fontSize = Math.max(9, fontSize);
      ctx.font = `700 ${fontSize}px "Space Grotesk", Arial, sans-serif`;

      // dark pill keeps digits legible against any tile colour
      const tw = ctx.measureText(label).width;
      const padX = fontSize * 0.3;
      const padY = fontSize * 0.2;
      const rw = tw + padX * 2;
      const rh = fontSize + padY * 2;
      const rr = rh / 2;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(px - rw / 2, py - rh / 2, rw, rh, rr);
      ctx.fillStyle = isEnd ? "rgba(70,45,0,0.5)" : isStart ? "rgba(0,50,28,0.5)" : "rgba(3,8,18,0.42)";
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.85)";
      ctx.shadowBlur = 5;
      ctx.fillStyle = isEnd ? "rgba(255,228,150,1)" : isStart ? "rgba(185,255,214,1)" : "rgba(233,243,255,0.9)";
      ctx.fillText(label, px, py);
      ctx.restore();
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 16;
    tex.needsUpdate = true;
    return tex;
  }, [def]);
}

export default function BoardMesh({
  def,
  activeCell = -1,
  flatView = false,
}: {
  def: BoardDef;
  activeCell?: number;
  flatView?: boolean;
}) {
  const finishRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const aRef = useRef<THREE.InstancedMesh>(null);
  const bRef = useRef<THREE.InstancedMesh>(null);
  const numbers = useNumberOverlay(def);

  const cellGeo = useMemo(() => {
    if (def.shape === "square") return new THREE.BoxGeometry(def.cellSize, CELL_Y, def.cellSize);
    if (def.shape === "hex") return new THREE.CylinderGeometry(def.cellSize / 2, def.cellSize / 2, CELL_Y, 6);
    // A 3-segment cylinder already points its first vertex at +z, which is the
    // board apex. The old rotateY(90°) twisted every tile off its cell axis.
    return new THREE.CylinderGeometry(def.cellSize / 1.72, def.cellSize / 1.72, CELL_Y, 3);
  }, [def]);

  const mats = useMemo(
    () => ({
      a: new THREE.MeshStandardMaterial({ color: CELL_A, roughness: 0.55, metalness: 0.15 }),
      b: new THREE.MeshStandardMaterial({ color: CELL_B, roughness: 0.55, metalness: 0.15 }),
      start: new THREE.MeshStandardMaterial({ color: START_C, roughness: 0.45, metalness: 0.1, emissive: "#0f5132", emissiveIntensity: 0.35 }),
      end: new THREE.MeshStandardMaterial({ color: END_C, roughness: 0.35, metalness: 0.3, emissive: "#b8860b", emissiveIntensity: 0.4 }),
      platform: new THREE.MeshStandardMaterial({ color: "#0a1220", roughness: 0.85, metalness: 0.1 }),
    }),
    []
  );

  // split interior cells into two checker groups (start/end drawn separately)
  const groups = useMemo(() => {
    const a: number[] = [];
    const b: number[] = [];
    def.cells.forEach((_, i) => {
      if (i === 0 || i === def.last) return;
      (i % 2 === 0 ? a : b).push(i);
    });
    return { a, b };
  }, [def]);

  useEffect(() => {
    const dummy = new THREE.Object3D();
    const fill = (mesh: THREE.InstancedMesh | null, list: number[]) => {
      if (!mesh) return;
      list.forEach((cellIdx, n) => {
        const c = def.cells[cellIdx];
        dummy.position.set(c.x, CELL_Y / 2, c.z);
        dummy.rotation.set(0, c.rot ?? 0, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        mesh.setMatrixAt(n, dummy.matrix);
      });
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    fill(aRef.current, groups.a);
    fill(bRef.current, groups.b);
  }, [def, groups]);

  useEffect(() => () => numbers.dispose(), [numbers]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (finishRef.current) {
      (finishRef.current.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.sin(t * 2.2) * 0.07;
    }
    if (ringRef.current) {
      ringRef.current.scale.setScalar(1 + Math.sin(t * 3) * 0.08);
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(t * 3) * 0.2;
    }
  });

  const last = def.cells[def.last];
  const first = def.cells[0];

  return (
    <group>
      {/* platform */}
      {def.shape === "square" && (
        <mesh position={[def.center.x, -0.17, def.center.z]} material={mats.platform}>
          <boxGeometry args={[def.radius * 2 + 1.2, 0.28, def.radius * 2 + 1.2]} />
        </mesh>
      )}
      {def.shape === "hex" && (
        <mesh position={[def.center.x, -0.17, def.center.z]} material={mats.platform}>
          <cylinderGeometry args={[def.radius * 1.04, def.radius * 1.08, 0.3, 6]} />
        </mesh>
      )}
      {def.shape === "triangle" && (
        <mesh position={[def.center.x, -0.17, def.center.z + 0.35]} rotation={[0, Math.PI, 0]} material={mats.platform}>
          <cylinderGeometry args={[def.radius * 1.18, def.radius * 1.24, 0.3, 3]} />
        </mesh>
      )}

      <mesh position={[def.center.x, -0.02, def.center.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[def.radius * 1.06, def.radius * 1.1, 64]} />
        <meshBasicMaterial color="#1d9bf0" transparent opacity={0.28} side={THREE.DoubleSide} />
      </mesh>

      {/* instanced cells — 2 draw calls for the whole board */}
      <instancedMesh ref={aRef} args={[cellGeo, mats.a, Math.max(1, groups.a.length)]} frustumCulled={false} receiveShadow />
      <instancedMesh ref={bRef} args={[cellGeo, mats.b, Math.max(1, groups.b.length)]} frustumCulled={false} receiveShadow />

      {/* start & finish tiles */}
      <mesh geometry={cellGeo} material={mats.start} position={[first.x, CELL_Y / 2, first.z]} rotation={[0, first.rot ?? 0, 0]} />
      <mesh geometry={cellGeo} material={mats.end} position={[last.x, CELL_Y / 2, last.z]} rotation={[0, last.rot ?? 0, 0]} />

      {/* all cell numbers in one draw call */}
      <mesh position={[def.center.x, CELL_Y + 0.008, def.center.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[def.radius * 2, def.radius * 2]} />
        <meshBasicMaterial map={numbers} transparent depthWrite={false} opacity={0.95} />
      </mesh>

      {activeCell >= 0 && activeCell <= def.last && (
        <mesh
          ref={ringRef}
          position={[def.cells[activeCell].x, CELL_Y + 0.014, def.cells[activeCell].z]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[def.cellSize * 0.4, def.cellSize * 0.5, 32]} />
          <meshBasicMaterial color="#4ade80" transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* finish beacon — a 3.4-unit column would blot out the goal from overhead */}
      {!flatView ? (
        <group position={[last.x, CELL_Y, last.z]}>
          <mesh ref={finishRef} position={[0, 1.6, 0]}>
            <cylinderGeometry args={[0.34, 0.46, 3.4, 20, 1, true]} />
            <meshBasicMaterial color="#ffd166" transparent opacity={0.2} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
          </mesh>
          <mesh position={[0, 3.35, 0]}>
            <octahedronGeometry args={[0.28]} />
            <meshStandardMaterial color="#ffd166" emissive="#ffb703" emissiveIntensity={1.4} metalness={0.6} roughness={0.2} />
          </mesh>
        </group>
      ) : (
        <mesh position={[last.x, CELL_Y + 0.016, last.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[def.cellSize * 0.34, def.cellSize * 0.46, 32]} />
          <meshBasicMaterial color="#ffd166" transparent opacity={0.75} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* start pad */}
      <mesh position={[def.start.x, 0.02, def.start.z]}>
        <cylinderGeometry args={[0.62, 0.7, 0.1, 24]} />
        <meshStandardMaterial color="#0e3a24" emissive="#16a34a" emissiveIntensity={0.35} roughness={0.5} />
      </mesh>
      <mesh position={[def.start.x, 0.08, def.start.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.42, 0.55, 24]} />
        <meshBasicMaterial color="#22c55e" transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

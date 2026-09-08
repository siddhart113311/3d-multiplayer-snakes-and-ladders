"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SnakeVisual } from "@/game/director";
import { SNAKE_PALETTE } from "@/game/snakeCurves";
import { buildSnakeGeometry, radiusAt, snakeSkinTexture } from "@/game/snakeSkin";

const placeholderGeo = new THREE.BufferGeometry();
const BASE_R = 0.165;

export default function SnakeMesh({
  visual,
  paletteIdx,
  charging,
  mobileQuality = false,
}: {
  visual: SnakeVisual;
  paletteIdx: number;
  charging: boolean;
  mobileQuality?: boolean;
}) {
  const bodyRef = useRef<THREE.Mesh>(null);
  const headRef = useRef<THREE.Group>(null);
  const jawRef = useRef<THREE.Group>(null);
  const tongueRef = useRef<THREE.Group>(null);

  const geoRef = useRef<THREE.BufferGeometry | null>(null);
  const localVersion = useRef(-1);
  const palette = SNAKE_PALETTE[paletteIdx % SNAKE_PALETTE.length];

  const skin = useMemo(
    () => snakeSkinTexture(palette, paletteIdx + 1, mobileQuality ? 256 : 512),
    [palette, paletteIdx, mobileQuality]
  );

  // Uniforms driving the travelling swallow-lump. Kept in a ref so the render
  // loop can update them without recompiling the shader.
  const bulgeUniforms = useRef({
    uBulgeT: { value: -1 },
    uBulgeAmp: { value: 0 },
    uUvRepeat: { value: 8 },
    uBulgeWidth: { value: 0.055 },
  });

  const mats = useMemo(() => {
    const body = new THREE.MeshStandardMaterial({
      map: skin.map,
      bumpMap: skin.bump,
      bumpScale: 0.035,
      roughness: 0.42,
      metalness: 0.08,
      emissive: new THREE.Color(palette.body),
      emissiveIntensity: 0.08,
    });

    // Push the body outward along its normals around the lump position. Doing
    // this on the GPU means the swell is perfectly smooth and costs nothing —
    // no per-frame geometry rebuilds.
    body.onBeforeCompile = (shader) => {
      shader.uniforms.uBulgeT = bulgeUniforms.current.uBulgeT;
      shader.uniforms.uBulgeAmp = bulgeUniforms.current.uBulgeAmp;
      shader.uniforms.uUvRepeat = bulgeUniforms.current.uUvRepeat;
      shader.uniforms.uBulgeWidth = bulgeUniforms.current.uBulgeWidth;

      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
           uniform float uBulgeT;
           uniform float uBulgeAmp;
           uniform float uUvRepeat;
           uniform float uBulgeWidth;
           varying float vBulge;`
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
           float bodyT = uv.x / max(0.0001, uUvRepeat);
           float dT = bodyT - uBulgeT;
           float g = exp(-(dT * dT) / (2.0 * uBulgeWidth * uBulgeWidth));
           // slight teardrop: fuller behind the lump than in front of it
           g *= (dT > 0.0) ? 1.0 : 0.82;
           vBulge = g * step(0.0, uBulgeT);
           transformed += normalize(objectNormal) * vBulge * uBulgeAmp;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\nvarying float vBulge;`)
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
           // skin stretches pale and hot where the player is trapped
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.87, 0.55), clamp(vBulge, 0.0, 1.0) * 0.55);
           totalEmissiveRadiance += vec3(1.0, 0.66, 0.22) * clamp(vBulge, 0.0, 1.0) * 0.55;`
        );
    };
    // distinguish this program from other MeshStandardMaterials
    body.customProgramCacheKey = () => "snakeBulge";

    return {
      body,
      head: new THREE.MeshStandardMaterial({ map: skin.map, bumpMap: skin.bump, bumpScale: 0.03, roughness: 0.4, metalness: 0.08 }),
      mouth: new THREE.MeshStandardMaterial({ color: "#8d1b3d", roughness: 0.55 }),
      fang: new THREE.MeshStandardMaterial({ color: "#fffdf5", roughness: 0.25 }),
      eye: new THREE.MeshStandardMaterial({ color: "#f8d34a", roughness: 0.15, emissive: "#a67c00", emissiveIntensity: 0.4 }),
      pupil: new THREE.MeshStandardMaterial({ color: "#08080c", roughness: 0.05 }),
      tongue: new THREE.MeshStandardMaterial({ color: "#ff2d55", roughness: 0.3, emissive: "#ff2d55", emissiveIntensity: 0.5 }),
    };
  }, [skin, palette]);

  useEffect(() => {
    const held = mats;
    return () => {
      geoRef.current?.dispose();
      geoRef.current = null;
      for (const m of Object.values(held)) m.dispose();
    };
  }, [mats]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const body = bodyRef.current;
    if (!body) return;

    if (visual.version !== localVersion.current) {
      localVersion.current = visual.version;
      // Cheap length estimate from 8 samples. curve.getLength() re-integrates over
      // 200 divisions, and during a fire-mode migration the curve is rebuilt every
      // frame — this keeps that path allocation-light.
      let len = 0;
      let prev = visual.curve.getPoint(0);
      for (let i = 1; i <= 8; i++) {
        const p = visual.curve.getPoint(i / 8);
        len += prev.distanceTo(p);
        prev = p;
      }
      const uvRepeat = Math.max(4, Math.round(len * 1.5));
      // Mobile keeps the same silhouette and shader deformation with ~55% fewer
      // body vertices, reducing upload cost during Fire-Mode migrations.
      const geo = buildSnakeGeometry(visual.curve, BASE_R, mobileQuality ? 72 : 104, mobileQuality ? 9 : 12, uvRepeat);
      geoRef.current?.dispose();
      geoRef.current = geo;
      body.geometry = geo;
      // the shader recovers body-t from uv.x, so it must know the tiling factor
      bulgeUniforms.current.uUvRepeat.value = uvRepeat;
    }

    const breathe = Math.sin(t * 2.4) * 0.01;
    body.scale.setScalar(1 + breathe);
    mats.body.emissiveIntensity = charging ? 0.3 + Math.abs(Math.sin(t * 5)) * 0.7 : 0.08;

    // head rides the curve origin and looks down the body
    const hp = visual.curve.getPointAt(0);
    const tan = visual.curve.getTangentAt(0);
    if (headRef.current) {
      headRef.current.position.copy(hp);
      headRef.current.lookAt(hp.clone().sub(tan));
      headRef.current.rotateZ(Math.sin(t * 1.7) * 0.05);
    }

    if (jawRef.current) jawRef.current.rotation.x = 0.12 + visual.mouth * 0.95;
    if (tongueRef.current) {
      const flick = Math.sin(t * 6) > 0.55 || visual.mouth > 0.4;
      tongueRef.current.visible = flick;
      tongueRef.current.scale.z = flick ? 0.8 + Math.abs(Math.sin(t * 9)) * 0.5 : 1;
    }

    // drive the GPU swell
    const u = bulgeUniforms.current;
    if (visual.bulge.active && visual.bulge.amp > 0.001) {
      const bt = THREE.MathUtils.clamp(visual.bulge.t, 0, 1);
      u.uBulgeT.value = bt;
      // Keep the lump readable in the thin tail without ballooning the thick
      // midsection: blend a constant size with the local body radius.
      const local = radiusAt(bt, BASE_R) / BASE_R;
      u.uBulgeAmp.value = visual.bulge.amp * BASE_R * (0.95 + 0.75 * local);
      // the swell narrows a little as it squeezes toward the tip
      u.uBulgeWidth.value = 0.052 - bt * 0.014;
    } else {
      u.uBulgeT.value = -1;
      u.uBulgeAmp.value = 0;
    }
  });

  const headScale = 1.22;

  return (
    <group>
      <mesh ref={bodyRef} material={mats.body} geometry={placeholderGeo} castShadow />

      {/* head */}
      <group ref={headRef} scale={headScale}>
        {/* wedge skull */}
        <mesh material={mats.head} position={[0, 0.01, 0.09]} scale={[0.2, 0.145, 0.27]}>
          <sphereGeometry args={[1, 20, 16]} />
        </mesh>
        {/* snout */}
        <mesh material={mats.head} position={[0, -0.005, 0.28]} scale={[0.125, 0.1, 0.14]}>
          <sphereGeometry args={[1, 16, 12]} />
        </mesh>
        {/* brow ridges */}
        {[0.1, -0.1].map((x) => (
          <mesh key={x} material={mats.head} position={[x, 0.085, 0.14]} scale={[0.075, 0.05, 0.13]}>
            <sphereGeometry args={[1, 12, 10]} />
          </mesh>
        ))}
        {/* hinged lower jaw */}
        <group ref={jawRef} position={[0, -0.055, 0.06]}>
          <mesh material={mats.head} position={[0, -0.03, 0.14]} scale={[0.155, 0.06, 0.24]}>
            <sphereGeometry args={[1, 16, 12]} />
          </mesh>
          <mesh material={mats.mouth} position={[0, 0.012, 0.14]} scale={[0.13, 0.02, 0.21]}>
            <sphereGeometry args={[1, 14, 10]} />
          </mesh>
          {[0.07, -0.07].map((x) => (
            <mesh key={x} material={mats.fang} position={[x, 0.03, 0.3]} rotation={[Math.PI, 0, 0]}>
              <coneGeometry args={[0.016, 0.075, 8]} />
            </mesh>
          ))}
          <group ref={tongueRef} position={[0, 0.02, 0.34]}>
            <mesh material={mats.tongue} position={[0.02, 0, 0.1]} rotation={[0, 0.22, 0]}>
              <boxGeometry args={[0.02, 0.01, 0.24]} />
            </mesh>
            <mesh material={mats.tongue} position={[-0.02, 0, 0.1]} rotation={[0, -0.22, 0]}>
              <boxGeometry args={[0.02, 0.01, 0.24]} />
            </mesh>
          </group>
        </group>
        {/* upper fangs */}
        {[0.075, -0.075].map((x) => (
          <mesh key={x} material={mats.fang} position={[x, -0.045, 0.29]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.019, 0.09, 8]} />
          </mesh>
        ))}
        {/* slit-pupil eyes */}
        {[0.115, -0.115].map((x) => (
          <group key={x} position={[x, 0.075, 0.18]}>
            <mesh material={mats.eye}>
              <sphereGeometry args={[0.062, 14, 12]} />
            </mesh>
            <mesh material={mats.pupil} position={[0, 0, 0.048]} scale={[0.22, 1, 0.4]}>
              <sphereGeometry args={[0.038, 10, 10]} />
            </mesh>
          </group>
        ))}
        {/* nostrils */}
        {[0.035, -0.035].map((x) => (
          <mesh key={x} material={mats.pupil} position={[x, 0.02, 0.4]}>
            <sphereGeometry args={[0.012, 8, 6]} />
          </mesh>
        ))}
      </group>

      {/* the swallowed player is now a real deformation of the body mesh above */}
    </group>
  );
}

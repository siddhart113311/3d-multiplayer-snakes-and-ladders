"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SnakeVisual, MAX_SNAKE_PTS } from "@/game/director";
import { SNAKE_PALETTE } from "@/game/snakeCurves";
import { buildStaticSnakeTube, radiusAt, snakeSkinTexture } from "@/game/snakeSkin";

const BASE_R = 0.165;

/* ---------- GLSL snippets for the GPU spline shader ---------- */

const VERT_PREAMBLE = /* glsl */ `#include <common>
#define MAX_PTS ${MAX_SNAKE_PTS}
uniform vec3 uCtrlPts[MAX_PTS];
uniform int  uNumPts;
uniform float uBulgeT;
uniform float uBulgeAmp;
uniform float uUvRepeat;
uniform float uBulgeWidth;
attribute float aBodyT;
attribute float aAngle;
varying float vBulge;

vec3 crSeg(int a, int b, int c, int d, float t) {
  float t2 = t * t, t3 = t2 * t;
  vec3 p0 = uCtrlPts[a], p1 = uCtrlPts[b], p2 = uCtrlPts[c], p3 = uCtrlPts[d];
  return 0.5 * ((2.0*p1) + (-p0+p2)*t + (2.0*p0-5.0*p1+4.0*p2-p3)*t2 + (-p0+3.0*p1-3.0*p2+p3)*t3);
}

vec3 evalSpline(float bT) {
  float clamped = clamp(bT, 0.0, 1.0);
  float segF = clamped * float(uNumPts - 1);
  int seg  = min(int(floor(segF)), uNumPts - 2);
  float lt = segF - float(seg);
  return crSeg(max(0, seg - 1), seg, min(seg + 1, uNumPts - 1), min(seg + 2, uNumPts - 1), lt);
}

float snakeRadius(float bT) {
  float r;
  if (bT < 0.06) {
    r = 0.82 + (bT / 0.06) * 0.14;
  } else if (bT < 0.55) {
    float u = (bT - 0.06) / 0.49;
    r = 0.96 + sin(u * 3.14159265) * 0.14;
  } else {
    float u = (bT - 0.55) / 0.45;
    r = 1.02 * pow(max(0.0001, 1.0 - u), 0.85);
  }
  return max(0.0008, r * ${BASE_R.toFixed(4)});
}
`;

const VERT_NORMAL = /* glsl */ `
  vec3 spP1 = evalSpline(max(0.0, aBodyT - 0.004));
  vec3 spP2 = evalSpline(min(1.0, aBodyT + 0.004));
  vec3 spP  = evalSpline(aBodyT);
  vec3 spT  = normalize(spP2 - spP1 + vec3(0.0, 0.00001, 0.0));

  vec3 spUp = abs(spT.y) > 0.92 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 spN  = normalize(cross(spUp, spT));
  vec3 spB  = cross(spT, spN);

  float spR = snakeRadius(aBodyT);
  float sinA = sin(aAngle);
  float cosA = cos(aAngle);
  float sq = 0.82;
  float bellySquash = spR * (1.0 - (1.0 - sq) * max(0.0, -cosA));

  vec3 objectNormal = normalize(sinA * spN * bellySquash + cosA * spB * spR);

  #ifdef USE_TANGENT
    vec3 objectTangent = vec3( tangent.xyz );
  #endif
`;

const VERT_POSITION = /* glsl */ `
  vec3 transformed = spP + sinA * spN * spR + cosA * spB * bellySquash;

  float dT = aBodyT - uBulgeT;
  float bulgeG = exp(-(dT * dT) / (2.0 * uBulgeWidth * uBulgeWidth));
  bulgeG *= (dT > 0.0) ? 1.0 : 0.82;
  vBulge = bulgeG * step(0.0, uBulgeT);
  transformed += objectNormal * vBulge * uBulgeAmp;
`;

const VERT_UV = /* glsl */ `#include <uv_vertex>
  #if defined( USE_UV ) || defined( USE_ANISOTROPY )
    vUv = vec2(aBodyT * uUvRepeat, aAngle / 6.28318530718);
  #endif
  #ifdef USE_MAP
    vMapUv = vec2(aBodyT * uUvRepeat, aAngle / 6.28318530718);
  #endif
  #ifdef USE_BUMPMAP
    vBumpMapUv = vec2(aBodyT * uUvRepeat, aAngle / 6.28318530718);
  #endif
`;

const FRAG_BULGE = /* glsl */ `#include <emissivemap_fragment>
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.87, 0.55), clamp(vBulge, 0.0, 1.0) * 0.55);
  totalEmissiveRadiance += vec3(1.0, 0.66, 0.22) * clamp(vBulge, 0.0, 1.0) * 0.55;
`;

/* ---------------------------------------------------------------- */

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

  const palette = SNAKE_PALETTE[paletteIdx % SNAKE_PALETTE.length];

  const skin = useMemo(
    () => snakeSkinTexture(palette, paletteIdx + 1, mobileQuality ? 256 : 512),
    [palette, paletteIdx, mobileQuality]
  );

  // Static tube geometry — built once, never rebuilt
  const staticGeo = useMemo(
    () => buildStaticSnakeTube(mobileQuality ? 72 : 104, mobileQuality ? 9 : 12, BASE_R),
    [mobileQuality]
  );

  // Pre-allocate uniform control point vectors, initialized from visual.controlPts
  const ctrlPtVecs = useMemo(() => {
    const arr = Array.from({ length: MAX_SNAKE_PTS }, () => new THREE.Vector3());
    const pts = visual.controlPts;
    const n = visual.numPts || MAX_SNAKE_PTS;
    for (let i = 0; i < n; i++) {
      arr[i].set(pts[i * 3] || 0, pts[i * 3 + 1] || 0, pts[i * 3 + 2] || 0);
    }
    return arr;
  }, [visual]);

  const shaderUniforms = useRef({
    uCtrlPts:   { value: ctrlPtVecs },
    uNumPts:    { value: MAX_SNAKE_PTS },
    uBulgeT:    { value: -1 },
    uBulgeAmp:  { value: 0 },
    uUvRepeat:  { value: 8 },
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
      side: THREE.DoubleSide,
    });

    body.onBeforeCompile = (shader) => {
      const su = shaderUniforms.current;
      shader.uniforms.uCtrlPts   = su.uCtrlPts;
      shader.uniforms.uNumPts    = su.uNumPts;
      shader.uniforms.uBulgeT    = su.uBulgeT;
      shader.uniforms.uBulgeAmp  = su.uBulgeAmp;
      shader.uniforms.uUvRepeat  = su.uUvRepeat;
      shader.uniforms.uBulgeWidth = su.uBulgeWidth;

      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", VERT_PREAMBLE)
        .replace("#include <beginnormal_vertex>", VERT_NORMAL)
        .replace("#include <begin_vertex>", VERT_POSITION)
        .replace("#include <uv_vertex>", VERT_UV);

      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\nvarying float vBulge;`)
        .replace("#include <emissivemap_fragment>", FRAG_BULGE);
    };
    body.customProgramCacheKey = () => "snakeSplineV4";

    return {
      body,
      head: new THREE.MeshStandardMaterial({ map: skin.map, bumpMap: skin.bump, bumpScale: 0.03, roughness: 0.4, metalness: 0.08 }),
      mouth: new THREE.MeshStandardMaterial({ color: "#8d1b3d", roughness: 0.55 }),
      fang: new THREE.MeshStandardMaterial({ color: "#fffdf5", roughness: 0.25 }),
      eye: new THREE.MeshStandardMaterial({ color: "#f8d34a", roughness: 0.15, emissive: "#a67c00", emissiveIntensity: 0.4 }),
      pupil: new THREE.MeshStandardMaterial({ color: "#08080c", roughness: 0.05 }),
      tongue: new THREE.MeshStandardMaterial({ color: "#ff2d55", roughness: 0.3, emissive: "#ff2d55", emissiveIntensity: 0.5 }),
    };
  }, [skin, palette, ctrlPtVecs]);

  useEffect(() => {
    const held = mats;
    return () => {
      for (const m of Object.values(held)) m.dispose();
    };
  }, [mats]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const body = bodyRef.current;
    if (!body) return;

    const su = shaderUniforms.current;
    const pts = visual.controlPts;
    const n = visual.numPts;

    // Copy control points to uniform vectors (~48 floats, <0.01ms)
    for (let i = 0; i < n; i++) {
      ctrlPtVecs[i].set(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
    }
    su.uNumPts.value = n;

    // Compute uvRepeat from control point path length
    let len = 0;
    for (let i = 1; i < n; i++) {
      const dx = pts[i * 3]     - pts[(i - 1) * 3];
      const dy = pts[i * 3 + 1] - pts[(i - 1) * 3 + 1];
      const dz = pts[i * 3 + 2] - pts[(i - 1) * 3 + 2];
      len += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    su.uUvRepeat.value = Math.max(4, Math.round(len * 1.5));

    // Breathing scale
    const breathe = Math.sin(t * 2.4) * 0.01;
    body.scale.setScalar(1 + breathe);
    mats.body.emissiveIntensity = charging ? 0.3 + Math.abs(Math.sin(t * 5)) * 0.7 : 0.08;

    // Head position from first control point + tangent from first two points
    const hx = pts[0], hy = pts[1], hz = pts[2];
    const tx = pts[3] - hx, ty = pts[4] - hy, tz = pts[5] - hz;

    if (headRef.current) {
      headRef.current.position.set(hx, hy, hz);
      headRef.current.lookAt(hx - tx, hy - ty, hz - tz);
      headRef.current.rotateZ(Math.sin(t * 1.7) * 0.05);
    }

    if (jawRef.current) jawRef.current.rotation.x = 0.12 + visual.mouth * 0.95;
    if (tongueRef.current) {
      const flick = Math.sin(t * 6) > 0.55 || visual.mouth > 0.4;
      tongueRef.current.visible = flick;
      tongueRef.current.scale.z = flick ? 0.8 + Math.abs(Math.sin(t * 9)) * 0.5 : 1;
    }

    // Drive the GPU bulge swell
    if (visual.bulge.active && visual.bulge.amp > 0.001) {
      const bt = THREE.MathUtils.clamp(visual.bulge.t, 0, 1);
      su.uBulgeT.value = bt;
      const local = radiusAt(bt, BASE_R) / BASE_R;
      su.uBulgeAmp.value = visual.bulge.amp * BASE_R * (0.95 + 0.75 * local);
      su.uBulgeWidth.value = 0.052 - bt * 0.014;
    } else {
      su.uBulgeT.value = -1;
      su.uBulgeAmp.value = 0;
    }
  });

  const headScale = 1.22;

  return (
    <group>
      <mesh ref={bodyRef} material={mats.body} geometry={staticGeo} castShadow frustumCulled={false} />

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

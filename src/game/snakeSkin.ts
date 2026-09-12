"use client";

// Procedural snake anatomy: a tapered tube (thick neck → pointed tail tip) and
// a painted scale/spot skin texture. Replaces the old constant-radius tube that
// read as a rubber pipe.

import * as THREE from "three";

export interface SkinPalette {
  body: string;
  belly: string;
  accent: string;
}

/**
 * Radius profile along the body (t: 0 = head, 1 = tail tip).
 * Slight neck pinch behind the head, a broad midsection, then a sharp taper
 * to an actual point so the tail doesn't need a cone cap.
 */
export function radiusAt(t: number, base: number): number {
  let r: number;
  if (t < 0.06) {
    // neck: slightly slimmer than the skull
    r = 0.82 + (t / 0.06) * 0.14;
  } else if (t < 0.55) {
    // fed midsection swell
    const u = (t - 0.06) / 0.49;
    r = 0.96 + Math.sin(u * Math.PI) * 0.14;
  } else {
    // long taper to a true point
    const u = (t - 0.55) / 0.45;
    r = 1.02 * Math.pow(1 - u, 0.85);
  }
  return Math.max(0.0008, r * base);
}

/** Tapered tube around a curve, with UVs laid out for tiling scale texture. */
export function buildSnakeGeometry(
  curve: THREE.Curve<THREE.Vector3>,
  baseRadius: number,
  tubular = 96,
  radial = 12,
  uvRepeat = 8
): THREE.BufferGeometry {
  const frames = (curve as THREE.CatmullRomCurve3).computeFrenetFrames(tubular, false);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const P = new THREE.Vector3();
  const N = new THREE.Vector3();
  const B = new THREE.Vector3();
  const vertex = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, P);
    N.copy(frames.normals[i]);
    B.copy(frames.binormals[i]);
    const r = radiusAt(t, baseRadius);
    // Slightly flattened belly (elliptical cross-section) reads far more organic
    // than a perfect circle.
    const squash = 0.82;

    for (let j = 0; j <= radial; j++) {
      const v = (j / radial) * Math.PI * 2;
      const sin = Math.sin(v);
      const cos = -Math.cos(v);
      normal.x = cos * N.x + sin * B.x;
      normal.y = cos * N.y + sin * B.y;
      normal.z = cos * N.z + sin * B.z;
      normal.normalize();
      const ry = r * (1 - (1 - squash) * Math.max(0, -Math.sin(v)));
      vertex.x = P.x + normal.x * (sin >= 0 ? r : ry);
      vertex.y = P.y + normal.y * ry;
      vertex.z = P.z + normal.z * (sin >= 0 ? r : ry);
      positions.push(vertex.x, vertex.y, vertex.z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(t * uvRepeat, j / radial);
    }
  }

  for (let i = 1; i <= tubular; i++) {
    for (let j = 1; j <= radial; j++) {
      const a = (radial + 1) * (i - 1) + (j - 1);
      const b = (radial + 1) * i + (j - 1);
      const c = (radial + 1) * i + j;
      const d = (radial + 1) * (i - 1) + j;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeBoundingSphere();
  return geo;
}

const _tubeCache = new Map<string, THREE.BufferGeometry>();

/**
 * One-time static tube geometry for the GPU spline shader.
 * Each vertex carries `aBodyT` (0 = head … 1 = tail) and `aAngle`
 * (radial position). The vertex shader bends this along the spline
 * control points — zero CPU geometry work after initial creation.
 */
export function buildStaticSnakeTube(
  tubular = 96,
  radial = 12,
  baseRadius = 0.165,
): THREE.BufferGeometry {
  const key = `${tubular}:${radial}`;
  const cached = _tubeCache.get(key);
  if (cached) return cached;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const bodyTs: number[] = [];
  const angles: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    const r = radiusAt(t, baseRadius);
    for (let j = 0; j <= radial; j++) {
      const angle = (j / radial) * Math.PI * 2;
      const sin = Math.sin(angle);
      const cos = -Math.cos(angle);
      // Placeholder straight tube — shader overrides at runtime
      positions.push(sin * r, cos * r, t * 5.0);
      normals.push(sin, cos, 0);
      uvs.push(t, j / radial);
      bodyTs.push(t);
      angles.push(angle);
    }
  }

  for (let i = 1; i <= tubular; i++) {
    for (let j = 1; j <= radial; j++) {
      const a = (radial + 1) * (i - 1) + (j - 1);
      const b = (radial + 1) * i + (j - 1);
      const c = (radial + 1) * i + j;
      const d = (radial + 1) * (i - 1) + j;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute("aBodyT", new THREE.Float32BufferAttribute(bodyTs, 1));
  geo.setAttribute("aAngle", new THREE.Float32BufferAttribute(angles, 1));
  // Large bounding sphere — actual positions are GPU-computed from control points
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
  geo.computeVertexNormals();

  _tubeCache.set(key, geo);
  return geo;
}

function shade(hex: string, amt: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * (amt < 0 ? 1.05 : 0.95)), THREE.MathUtils.clamp(hsl.l + amt, 0.02, 0.96));
  return `#${c.getHexString()}`;
}

const skinCache = new Map<string, { map: THREE.CanvasTexture; bump: THREE.CanvasTexture }>();

/**
 * Paints a tiling snake hide: diamond scales, a dark dorsal blotch chain,
 * speckles, and a pale scaled belly. Also emits a bump map from the same
 * pattern so scales catch the light individually.
 */
export function snakeSkinTexture(palette: SkinPalette, seed = 0, resolution = 512) {
  const W = Math.max(256, Math.min(512, resolution));
  const H = W / 2;
  const key = `${palette.body}|${palette.belly}|${palette.accent}|${seed}|${W}`;
  const cached = skinCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = W;
  bumpCanvas.height = H;
  const bctx = bumpCanvas.getContext("2d")!;
  bctx.fillStyle = "#808080";
  bctx.fillRect(0, 0, W, H);

  // v (y) wraps around the body: 0 = back ... 0.5 = belly ... 1 = back
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, shade(palette.body, -0.12));
  grad.addColorStop(0.22, palette.body);
  grad.addColorStop(0.42, shade(palette.belly, 0.16));
  grad.addColorStop(0.5, shade(palette.belly, 0.3));
  grad.addColorStop(0.58, shade(palette.belly, 0.16));
  grad.addColorStop(0.78, palette.body);
  grad.addColorStop(1, shade(palette.body, -0.12));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  let s = seed * 9301 + 49297;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };

  // dorsal blotch chain (the classic python/adder saddle markings)
  const blotch = shade(palette.body, -0.3);
  for (let i = 0; i < 9; i++) {
    const cx = (i + 0.5) * (W / 9) + (rnd() - 0.5) * 12;
    const rw = W / 26 + rnd() * 12;
    for (const cy of [10, H - 10]) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = blotch;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rw, H * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = shade(palette.accent, -0.05);
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();
    }
    // flank spots
    for (const cy of [H * 0.3, H * 0.7]) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = shade(palette.body, -0.22);
      ctx.beginPath();
      ctx.ellipse(cx + W / 18, cy + (rnd() - 0.5) * 14, rw * 0.42, H * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // overlapping diamond scales + matching bump
  const cols = 64;
  const rows = 26;
  const sw = W / cols;
  const sh = H / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const off = r % 2 === 0 ? 0 : sw / 2;
      const x = c * sw + off;
      const y = r * sh;
      const belly = Math.abs(r / rows - 0.5) < 0.1;

      ctx.beginPath();
      ctx.moveTo(x, y + sh / 2);
      ctx.quadraticCurveTo(x + sw / 2, y - sh * 0.18, x + sw, y + sh / 2);
      ctx.quadraticCurveTo(x + sw / 2, y + sh * 1.12, x, y + sh / 2);
      ctx.closePath();
      ctx.strokeStyle = belly ? "rgba(0,0,0,0.12)" : "rgba(0,0,0,0.26)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${0.02 + rnd() * 0.05})`;
      ctx.fill();

      bctx.beginPath();
      bctx.moveTo(x, y + sh / 2);
      bctx.quadraticCurveTo(x + sw / 2, y - sh * 0.18, x + sw, y + sh / 2);
      bctx.quadraticCurveTo(x + sw / 2, y + sh * 1.12, x, y + sh / 2);
      bctx.closePath();
      const g2 = bctx.createLinearGradient(x, y, x, y + sh);
      g2.addColorStop(0, "#f2f2f2");
      g2.addColorStop(1, "#4a4a4a");
      bctx.fillStyle = g2;
      bctx.fill();
      bctx.strokeStyle = "#2b2b2b";
      bctx.lineWidth = 1.2;
      bctx.stroke();
    }
  }

  // fine speckle
  for (let i = 0; i < 900; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    ctx.fillStyle = `rgba(0,0,0,${rnd() * 0.16})`;
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  // wet sheen along the spine
  const sheen = ctx.createLinearGradient(0, 0, 0, H);
  sheen.addColorStop(0, "rgba(255,255,255,0.14)");
  sheen.addColorStop(0.18, "rgba(255,255,255,0)");
  sheen.addColorStop(0.82, "rgba(255,255,255,0)");
  sheen.addColorStop(1, "rgba(255,255,255,0.14)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H);

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.wrapS = THREE.RepeatWrapping;
  bump.wrapT = THREE.RepeatWrapping;
  if (W <= 256) {
    map.generateMipmaps = false;
    map.minFilter = THREE.LinearFilter;
    map.anisotropy = 2;
    bump.generateMipmaps = false;
    bump.minFilter = THREE.LinearFilter;
  }

  const out = { map, bump };
  skinCache.set(key, out);
  return out;
}

"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { BoardDef } from "@/game/boards";
import { fitCameraDistance, getBreakpoint, refineFitDistance } from "@/game/viewport";
import { CELL_Y } from "@/game/snakeCurves";

export default function CameraRig({
  def,
  shake,
  preview = false,
  rotateSignal,
  flat = false,
}: {
  def: BoardDef;
  shake: { amp: number };
  preview?: boolean;
  rotateSignal?: React.MutableRefObject<{ az: number; pol: number }>;
  flat?: boolean;
}) {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera, size } = useThree();
  /**
   * Screen shake must never be written into the camera's *orbit state*.
   * OrbitControls.update() rebuilds the camera from spherical coords derived
   * from its current position, and at the near-zero polar angle used by the 2D
   * view the azimuth is degenerate — a few thousandths of jitter becomes an
   * arbitrary rotation. So track shake as a separate offset that is removed
   * before controls update and re-applied after.
   */
  const shakeOffset = useRef(new THREE.Vector3());
  const fittedRef = useRef(0);

  /**
   * Sample points describing the board's true silhouette: the four corners of
   * every cell footprint, plus raised points in 3D for the finish beacon and
   * reared snake heads. Rebuilt only when the board changes.
   */
  const samples = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const half = def.cellSize / 2;
    for (const c of def.cells) {
      for (const dx of [-half, half]) {
        for (const dz of [-half, half]) pts.push(new THREE.Vector3(c.x + dx, CELL_Y, c.z + dz));
      }
    }
    // staging pad sits off-board and must stay on screen too
    pts.push(new THREE.Vector3(def.start.x, CELL_Y, def.start.z));
    if (!flat) {
      const lastCell = def.cells[def.last];
      pts.push(new THREE.Vector3(lastCell.x, 3.7, lastCell.z)); // beacon tip
      for (const c of def.cells) pts.push(new THREE.Vector3(c.x, 0.6, c.z)); // reared snakes
    }
    return pts;
  }, [def, flat]);

  /** Distance at which the entire board fits the current viewport. */
  const computeDistance = useCallback(() => {
    const bp = getBreakpoint(size.width, size.height, 1);
    const persp = camera as THREE.PerspectiveCamera;
    const fovY = persp.isPerspectiveCamera ? persp.fov : 42;
    const aspect = size.width / Math.max(1, size.height);
    const insetX = preview ? 0.02 : bp.insetX;
    const insetY = preview ? 0.04 : bp.insetY;
    const margin = bp.margin * (preview ? 1.04 : 1);

    // first guess from the bounding sphere
    const seed = fitCameraDistance({
      radius: def.radius * (flat ? 1.0 : 1.12),
      fovY,
      aspect,
      margin,
      insetX,
      insetY,
    });

    // then refine against the real projected geometry
    const limX = (1 - insetX) / margin;
    const limY = (1 - insetY) / margin;
    const target = new THREE.Vector3(def.center.x, flat ? 0 : -0.2, def.center.z);
    const dir = flat ? new THREE.Vector3(0, 1, 0.00005) : new THREE.Vector3(0.16, 0.95, 0.82).normalize();
    const probe = new THREE.PerspectiveCamera(fovY, aspect, 0.1, 10000);
    const v = new THREE.Vector3();

    return refineFitDistance(seed, limX, limY, (d) => {
      probe.position.copy(target).addScaledVector(dir, d);
      probe.lookAt(target);
      probe.updateMatrixWorld(true);
      probe.updateProjectionMatrix();
      let mx = 0;
      let my = 0;
      for (const p of samples) {
        v.copy(p).project(probe);
        const ax = Math.abs(v.x);
        const ay = Math.abs(v.y);
        if (ax > mx) mx = ax;
        if (ay > my) my = ay;
      }
      return { mx, my };
    });
  }, [camera, size.width, size.height, def, flat, preview, samples]);

  /** Place the camera at the fitted distance, preserving the current angles. */
  const applyFit = useCallback(
    (reset: boolean) => {
      const c = controlsRef.current;
      if (!c) return;
      const dist = computeDistance();
      fittedRef.current = dist;
      shakeOffset.current.set(0, 0, 0);
      c.target.set(def.center.x, flat ? 0 : -0.2, def.center.z);

      if (flat) {
        // straight overhead; tiny z offset keeps the view matrix well defined
        camera.position.set(def.center.x, dist, def.center.z + 0.001);
      } else if (reset) {
        // canonical hero angle, scaled to the fitted distance
        const dir = new THREE.Vector3(0.16, 0.95, 0.82).normalize();
        camera.position.copy(c.target).addScaledVector(dir, dist);
      } else {
        // keep the player's orbit angles, just correct the distance
        const dir = camera.position.clone().sub(c.target);
        if (dir.lengthSq() < 1e-6) dir.set(0.16, 0.95, 0.82);
        dir.normalize();
        camera.position.copy(c.target).addScaledVector(dir, dist);
      }

      // Allow zooming in, but never further out than the fitted distance —
      // so the board is always at least fully visible.
      c.minDistance = dist * 0.34;
      c.maxDistance = dist * 1.02;
      camera.lookAt(c.target);
      const persp = camera as THREE.PerspectiveCamera;
      if (persp.isPerspectiveCamera) {
        persp.far = Math.max(220, dist * 4);
        persp.updateProjectionMatrix();
      }
      c.update();
    },
    [camera, computeDistance, def.center.x, def.center.z, flat]
  );

  // Re-fit on: board change, view-mode change, and every viewport resize or
  // device rotation (useThree().size updates on both).
  useEffect(() => {
    applyFit(true);
  }, [def, flat, applyFit]);

  useEffect(() => {
    applyFit(false);
  }, [size.width, size.height, applyFit]);

  // BEFORE drei's controls.update() (priority -1): hand controls a clean pose.
  useFrame(({ camera: cam }) => {
    if (shakeOffset.current.lengthSq() > 0) {
      cam.position.sub(shakeOffset.current);
      shakeOffset.current.set(0, 0, 0);
    }
    const c = controlsRef.current;
    if (!flat && c && rotateSignal && (rotateSignal.current.az !== 0 || rotateSignal.current.pol !== 0)) {
      const offset = cam.position.clone().sub(c.target);
      const sph = new THREE.Spherical().setFromVector3(offset);
      sph.theta += rotateSignal.current.az * 0.03;
      sph.phi = THREE.MathUtils.clamp(sph.phi + rotateSignal.current.pol * 0.02, 0.35, 1.25);
      cam.position.copy(c.target).add(new THREE.Vector3().setFromSpherical(sph));
    }
  }, -2);

  // AFTER controls.update(): apply shake purely as a render-time offset.
  useFrame(({ camera: cam }) => {
    if (shake.amp > 0.001) {
      shakeOffset.current.set(
        (Math.random() - 0.5) * shake.amp,
        (Math.random() - 0.5) * shake.amp * 0.7,
        (Math.random() - 0.5) * shake.amp
      );
      cam.position.add(shakeOffset.current);
      shake.amp *= 0.88;
    } else {
      shake.amp = 0;
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      enablePan={false}
      enableRotate={!flat}
      // pinch-zoom on touch, wheel on desktop
      enableZoom
      zoomSpeed={0.8}
      minPolarAngle={flat ? 0 : 0.3}
      maxPolarAngle={flat ? 0.0001 : 1.28}
      // Hard-pin the azimuth in 2D so the overhead view can never spin.
      minAzimuthAngle={flat ? 0 : -Infinity}
      maxAzimuthAngle={flat ? 0 : Infinity}
      autoRotate={preview && !flat}
      autoRotateSpeed={0.8}
      // one finger orbits (no-op in 2D since rotation is locked), two fingers pinch-zoom
      touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
    />
  );
}

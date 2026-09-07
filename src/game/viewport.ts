// Responsive camera fitting: guarantees the whole board is visible on any
// screen, in any orientation, for both the 3D and 2D views.

/** Degrees → radians. */
const rad = (deg: number) => (deg * Math.PI) / 180;

export interface FitOptions {
  /** Bounding radius of the board in world units. */
  radius: number;
  /** Vertical field of view in degrees. */
  fovY: number;
  /** viewportWidth / viewportHeight. */
  aspect: number;
  /** Extra breathing room, 1 = tight fit. */
  margin?: number;
  /**
   * Fraction of the viewport covered by HUD chrome on each edge, so the board
   * is fitted into the *free* area rather than behind the player tray / dock.
   */
  insetX?: number;
  insetY?: number;
}

/**
 * Distance required for a sphere of `radius` centred on the camera target to
 * fit entirely inside the frustum.
 *
 * A perspective camera's horizontal FOV depends on aspect ratio:
 *   tan(fovX/2) = tan(fovY/2) * aspect
 * On a portrait phone (aspect < 1) the horizontal angle is much *narrower*
 * than the vertical one, so fitting only to fovY clips the board's sides —
 * which is exactly what happened before. We therefore fit to whichever axis
 * is more constrained.
 */
export function fitCameraDistance({ radius, fovY, aspect, margin = 1.06, insetX = 0, insetY = 0 }: FitOptions): number {
  const safeAspect = Math.max(0.2, Math.min(5, aspect || 1));
  const halfY = rad(fovY) / 2;
  const halfX = Math.atan(Math.tan(halfY) * safeAspect);

  // HUD chrome shrinks the usable cone on each axis.
  const usableY = Math.max(0.12, 1 - Math.max(0, Math.min(0.8, insetY)));
  const usableX = Math.max(0.12, 1 - Math.max(0, Math.min(0.8, insetX)));
  const effHalfY = Math.atan(Math.tan(halfY) * usableY);
  const effHalfX = Math.atan(Math.tan(halfX) * usableX);

  const limiting = Math.min(effHalfY, effHalfX);
  // distance so the sphere's silhouette exactly touches the frustum edge
  return (radius * margin) / Math.sin(limiting);
}

/**
 * Exact fit by iterative refinement.
 *
 * The bounding-sphere formula above is a good first guess, but the real board
 * is a tilted disc whose near edge is magnified by perspective, so its true
 * projected extent can exceed the sphere estimate. Here we place the camera,
 * project the actual geometry, and rescale the distance by however much we
 * overflow (or underfill). Converges in 2–3 passes and only runs on
 * mount / resize, so the cost is irrelevant.
 *
 * @param project  positions the camera at distance d and returns the largest
 *                 |ndc.x| and |ndc.y| over all sampled board points.
 * @returns distance at which the board exactly fills the allowed NDC box.
 */
export function refineFitDistance(
  initial: number,
  limX: number,
  limY: number,
  project: (d: number) => { mx: number; my: number },
  iterations = 6
): number {
  let d = initial;
  for (let i = 0; i < iterations; i++) {
    const { mx, my } = project(d);
    const overflow = Math.max(mx / limX, my / limY);
    if (!Number.isFinite(overflow) || overflow <= 0) break;
    // NDC extent is very close to inversely proportional to distance
    const next = d * overflow;
    const delta = Math.abs(next - d) / d;
    d = next;
    if (delta < 0.002) break;
  }
  return d;
}

export interface Breakpoint {
  isPhone: boolean;
  isTablet: boolean;
  isPortrait: boolean;
  /** Renderer pixel-ratio cap — lower on phones to hold 60fps. */
  dprCap: number;
  /** HUD inset fractions used for camera fitting. */
  insetX: number;
  insetY: number;
  margin: number;
}

/** Derive layout/perf settings from the current viewport. */
export function getBreakpoint(width: number, height: number, devicePixelRatio = 1): Breakpoint {
  const min = Math.min(width, height);
  const isPhone = min < 640;
  const isTablet = !isPhone && min < 1024;
  const isPortrait = height >= width;

  // Phones: cap DPR harder (a 3x display would otherwise render 9x the pixels).
  const dprCap = isPhone ? Math.min(devicePixelRatio, 2) : isTablet ? Math.min(devicePixelRatio, 2) : Math.min(devicePixelRatio, 1.8);

  // The HUD hugs the top and bottom edges, and grows relatively larger on
  // small screens, so reserve more there.
  const insetY = isPhone ? (isPortrait ? 0.3 : 0.26) : isTablet ? 0.2 : 0.14;
  const insetX = isPhone ? (isPortrait ? 0.05 : 0.2) : 0.06;
  const margin = isPhone ? 1.08 : 1.05;

  return { isPhone, isTablet, isPortrait, dprCap, insetX, insetY, margin };
}

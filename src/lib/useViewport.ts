"use client";

import { useEffect, useState } from "react";
import { getBreakpoint, type Breakpoint } from "@/game/viewport";

const FALLBACK: Breakpoint & { width: number; height: number } = {
  isPhone: false,
  isTablet: false,
  isPortrait: false,
  dprCap: 1.8,
  insetX: 0.06,
  insetY: 0.14,
  margin: 1.06,
  width: 1280,
  height: 800,
};

/** Live viewport breakpoint, updated on resize and orientation change. */
export function useViewport() {
  const [vp, setVp] = useState(FALLBACK);

  useEffect(() => {
    const read = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setVp({ ...getBreakpoint(w, h, window.devicePixelRatio || 1), width: w, height: h });
    };
    read();
    window.addEventListener("resize", read, { passive: true });
    window.addEventListener("orientationchange", read);
    return () => {
      window.removeEventListener("resize", read);
      window.removeEventListener("orientationchange", read);
    };
  }, []);

  return vp;
}

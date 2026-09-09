"use client";

import { memo, useEffect, useMemo, useState } from "react";

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

// Rotations to bring each target face to the front (+Z camera view):
// Face 1 (front): identity
// Face 2 (right, rotateY 90): cancel with rotateY(-90deg)
// Face 3 (left, rotateY -90): cancel with rotateY(90deg)
// Face 4 (top, rotateX 90): cancel with rotateX(-90deg)
// Face 5 (bottom, rotateX -90): cancel with rotateX(90deg)
// Face 6 (back, rotateX 180): cancel with rotateX(180deg)
const ROT: Record<number, string> = {
  1: "rotateX(0deg) rotateY(0deg)",
  2: "rotateY(-90deg)",
  3: "rotateY(90deg)",
  4: "rotateX(-90deg)",
  5: "rotateX(90deg)",
  6: "rotateX(180deg)",
};

function Face({ n, transform }: { n: number; transform: string }) {
  return (
    <div
      className="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-0.5 rounded-xl border border-white/20 bg-gradient-to-br from-slate-100 to-slate-300 p-1.5 shadow-[inset_0_0_8px_rgba(0,0,0,0.25)]"
      style={{ transform, backfaceVisibility: "hidden" }}
    >
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="flex items-center justify-center">
          {PIPS[n].includes(i) && <div className="h-2 w-2 rounded-full bg-slate-900 shadow-inner md:h-2.5 md:w-2.5" />}
        </div>
      ))}
    </div>
  );
}

export default memo(function DiceCube({
  value,
  rolling,
  size = 52,
}: {
  value: number;
  rolling: boolean;
  size?: number;
}) {
  const [shown, setShown] = useState(value || 1);
  const [settled, setSettled] = useState(true);

  useEffect(() => {
    if (rolling) {
      setSettled(false);
      return;
    }
    if (value > 0) {
      setShown(value);
      // Ensure the rotation applies cleanly on settle
      const raf = requestAnimationFrame(() => setSettled(true));
      return () => cancelAnimationFrame(raf);
    }
  }, [rolling, value]);

  const s = size;
  const half = Math.round(s / 2);

  const faceTransforms = useMemo(
    () => [
      `translateZ(${half}px)`,
      `rotateY(90deg) translateZ(${half}px)`,
      `rotateY(-90deg) translateZ(${half}px)`,
      `rotateX(90deg) translateZ(${half}px)`,
      `rotateX(-90deg) translateZ(${half}px)`,
      `rotateX(180deg) translateZ(${half}px)`,
    ],
    [half]
  );

  return (
    <div style={{ width: s, height: s, perspective: 240 }} className="select-none">
      <div
        className={rolling ? "dice-tumble relative h-full w-full" : "relative h-full w-full"}
        style={{
          transformStyle: "preserve-3d",
          transform: settled && !rolling ? ROT[shown] : undefined,
          transition: settled && !rolling ? "transform 0.36s cubic-bezier(0.18, 1.25, 0.4, 1)" : undefined,
        }}
      >
        {faceTransforms.map((t, i) => (
          <Face key={i} n={i + 1} transform={t} />
        ))}
      </div>
    </div>
  );
});

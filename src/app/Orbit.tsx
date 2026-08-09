"use client";

import { useEffect, useRef, useState } from "react";

export type Box = { x: number; y: number; w: number; h: number };

const PERIOD_MS = 2600;
/** Keep the path clear of the box edge so it circles the thing, not its border. */
const MARGIN = 0.18;

/**
 * A red dot slowly circling inside a bounding box, like a finger drawing
 * circles over the thing being talked about.
 *
 * The ellipse is derived from the four midpoints of the box sides, inset by a
 * margin — so its radii are just the half-width and half-height, reduced.
 */
export default function Orbit({ box }: { box: Box | null }) {
  const [t, setT] = useState(0);
  const raf = useRef<number | null>(null);
  const start = useRef<number>(0);

  useEffect(() => {
    if (!box) return;
    start.current = performance.now();
    const step = (now: number) => {
      setT(((now - start.current) % PERIOD_MS) / PERIOD_MS);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [box]);

  if (!box) return null;

  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rx = (box.w / 2) * (1 - MARGIN);
  const ry = (box.h / 2) * (1 - MARGIN);

  const angle = t * Math.PI * 2;
  const px = cx + rx * Math.cos(angle);
  const py = cy + ry * Math.sin(angle);

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
    >
      <ellipse
        cx={cx}
        cy={cy}
        rx={rx}
        ry={ry}
        fill="none"
        stroke="#dc2626"
        strokeOpacity={0.25}
        strokeDasharray="4 4"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {/* r is in viewBox units, so scale it out of the 0-1 space */}
      <circle cx={px} cy={py} r={0.016} fill="#dc2626" />
      <circle cx={px} cy={py} r={0.03} fill="#dc2626" fillOpacity={0.25} />
    </svg>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

export type Box = { x: number; y: number; w: number; h: number };

const PERIOD_MS = 2600;
/** Keep the path clear of the box edge so it circles the thing, not its border. */
const MARGIN = 0.18;
/**
 * How fast the dot eases toward its target each frame (0-1 per ~16ms).
 * 0.15 keeps ~97% of the orbit radius while gliding between boxes in ~0.33s;
 * lower values visibly shrink the circle as the dot lags behind it.
 */
const EASE = 0.15;

type Pt = { x: number; y: number };

/**
 * A red dot slowly circling inside a bounding box, like a finger drawing
 * circles over the thing being talked about.
 *
 * The orbit ellipse comes from the box's side midpoints, inset by a margin.
 * When the target box changes the dot eases across rather than teleporting,
 * so it reads as one pointer travelling between elements.
 */
export default function Orbit({ box }: { box: Box | null }) {
  const [pos, setPos] = useState<Pt | null>(null);
  const posRef = useRef<Pt | null>(null);
  const boxRef = useRef<Box | null>(box);
  const raf = useRef<number | null>(null);
  const start = useRef<number>(performance.now());

  boxRef.current = box;

  useEffect(() => {
    const step = (now: number) => {
      const b = boxRef.current;
      if (b) {
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        const rx = (b.w / 2) * (1 - MARGIN);
        const ry = (b.h / 2) * (1 - MARGIN);
        const a = (((now - start.current) % PERIOD_MS) / PERIOD_MS) * Math.PI * 2;
        const target = { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };

        // Ease toward the orbit point; on a box change this glides across
        // instead of jumping, and once there it tracks the circle closely.
        const cur = posRef.current;
        const next = cur
          ? { x: cur.x + (target.x - cur.x) * EASE, y: cur.y + (target.y - cur.y) * EASE }
          : target;
        posRef.current = next;
        setPos(next);
      } else if (posRef.current) {
        posRef.current = null;
        setPos(null);
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, []);

  if (!pos) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
    >
      <circle cx={pos.x} cy={pos.y} r={0.03} fill="#dc2626" fillOpacity={0.2} />
      <circle cx={pos.x} cy={pos.y} r={0.015} fill="#dc2626" />
    </svg>
  );
}

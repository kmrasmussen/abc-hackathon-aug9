/** One thing that happened, in order. Strokes, points and speech share a timeline. */
export type LogEvent = {
  id: number;
  at: number;
  kind: "stroke" | "erase" | "point" | "speech" | "assistant";
  /** Bounding box of the ink, in 0-1 canvas coords. Absent for speech. */
  box?: { x: number; y: number; w: number; h: number };
  /** What was said, for speech events. */
  text?: string;
  /** Node or edge label this event was matched to, once a run commits. */
  match?: string;
};

export type Box = { x: number; y: number; w: number; h: number };

const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** Fraction of `a` that lies inside `b`. */
export function overlap(a: Box, b: Box): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = x * y;
  const area = a.w * a.h;
  if (area <= 0) {
    // A dot has no area — fall back to containment of its centre.
    const c = centre(a);
    return c.x >= b.x && c.x <= b.x + b.w && c.y >= b.y && c.y <= b.y + b.h ? 1 : 0;
  }
  return inter / area;
}

/** Adjacent events of the same kind on the same element, merged into one row. */
export type CoalescedEvent = {
  id: number;
  /** When the run of events ended. */
  at: number;
  /** When it started — equal to `at` for a single event. */
  from: number;
  kind: LogEvent["kind"];
  /** How many raw events were folded in. */
  count: number;
  match?: string;
  /** Speech text is concatenated rather than counted. */
  text?: string;
};

/**
 * Fold runs of adjacent events that share a kind and a matched element.
 *
 * Drawing one circle is a dozen strokes and pointing at it is a dozen moves;
 * as a story of what happened, both are one act. Speech is never merged — each
 * utterance is its own thought.
 */
export function coalesce(events: LogEvent[]): CoalescedEvent[] {
  const out: CoalescedEvent[] = [];

  for (const e of events) {
    const prev = out[out.length - 1];
    const mergeable =
      prev &&
      e.kind !== "speech" &&
      e.kind !== "assistant" &&
      prev.kind === e.kind &&
      prev.match === e.match;

    if (mergeable) {
      prev.at = e.at;
      prev.count += 1;
      continue;
    }

    out.push({
      id: e.id,
      at: e.at,
      from: e.at,
      kind: e.kind,
      count: 1,
      match: e.match,
      text: e.text,
    });
  }

  return out;
}

/**
 * Attach a label to each event.
 *
 * Ink events match the committed box they sit most inside. Speech has no
 * position, so it borrows the match of the nearest ink event in time — that's
 * what links "this is the frontend" to the shape being drawn as it was said.
 */
export function matchEvents(
  events: LogEvent[],
  labelled: { label: string; box: Box }[],
  speechWindowMs = 8000,
): LogEvent[] {
  const withInk = events.map((e) => {
    if (!e.box) return e;
    let best: string | undefined;
    let bestScore = 0.15; // require a real overlap, not a graze
    for (const l of labelled) {
      const score = overlap(e.box, l.box);
      if (score > bestScore) {
        bestScore = score;
        best = l.label;
      }
    }
    return { ...e, match: best };
  });

  return withInk.map((e) => {
    // Assistant turns already know what they pointed at.
    if (e.kind !== "speech") return e;
    let best: LogEvent | undefined;
    let bestDt = speechWindowMs;
    for (const other of withInk) {
      if (!other.match || other.kind === "speech") continue;
      const dt = Math.abs(other.at - e.at);
      if (dt < bestDt) {
        bestDt = dt;
        best = other;
      }
    }
    return { ...e, match: best?.match };
  });
}

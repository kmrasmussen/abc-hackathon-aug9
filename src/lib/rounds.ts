import type { CoalescedEvent } from "./events";

/**
 * One exchange: everything the user did and said since the last reply, the
 * drawing as it looked at that moment, and what the assistant said back.
 *
 * Rounds are what get replayed to the model, so each user turn carries its own
 * image and its own events — not a running flat log where it's ambiguous which
 * drawing a comment referred to.
 */
export type Round = {
  /** Events in this round, excluding the assistant's own reply. */
  events: CoalescedEvent[];
  /** The committed frame as it looked when the assistant answered. */
  image: string | null;
  /** Mermaid for that frame. */
  mermaid: string | null;
  /** Labels that existed on that frame. */
  labels: string[];
  /** What the assistant said back. */
  reply: string;
};

/** Render one round's events as the text shown to the model. */
export function roundToText(round: Round, t0?: number): string {
  const base = t0 ?? round.events[0]?.at;
  const lines = round.events.map((g) => {
    const dt = base === undefined ? 0 : (g.at - base) / 1000;
    const times = g.count > 1 ? ` x${g.count}` : "";
    const text = g.text ? ` "${g.text}"` : "";
    const match = g.match ? ` -> ${g.match}` : "";
    return `+${dt.toFixed(1)}s ${g.kind}${times}${text}${match}`;
  });
  return lines.join("\n");
}

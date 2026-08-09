import { NextResponse } from "next/server";

const MODEL = "google/gemma-4-31b-it";

/** One span of speech, optionally pointing at something while it is said. */
export type Segment = { text: string; at: string | null };

const PROMPT = `You are looking at a diagram someone just drew while talking you
through it. You are about to SAY your response out loud while POINTING at the
diagram, like an enthusiastic guide showing off.

Wrap any part of your speech in <pointing at="LABEL"> tags to point at that
element while saying those words. Use the labels exactly as given — node labels
like "Frontend", or edge labels like "A -> B".

Point a LOT. Almost too much. Every time you mention something on the diagram,
point at it. It should feel like an excited "look what I can do" demonstration.

Example:
Nice work! <pointing at="A">This root here</pointing> branches out into
<pointing at="A -> Child1">this arrow</pointing> and lands on
<pointing at="Child1">Child1</pointing>, which is where it gets interesting.

Keep it to 3-5 sentences. Speak naturally — it will be read aloud, so no
markdown, no lists, no stage directions. Do not mention the tags themselves.`;

/** Split the reply into ordered segments, each with what to point at. */
export function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const re = /<pointing\s+at="([^"]*)"\s*>([\s\S]*?)<\/pointing>/gi;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const before = text.slice(last, m.index).trim();
    if (before) segments.push({ text: before, at: null });
    const inner = m[2].trim();
    if (inner) segments.push({ text: inner, at: m[1] });
    last = m.index + m[0].length;
  }
  const tail = text.slice(last).trim();
  if (tail) segments.push({ text: tail, at: null });

  // Each segment is synthesised separately, so a fragment like "!" or ". Then,"
  // would be its own audible blip. Carry those forward onto the next segment
  // rather than back, so a pointed segment's highlight isn't stretched out.
  const merged: Segment[] = [];
  let carry = "";
  for (const seg of segments) {
    const isScrap = seg.at === null && seg.text.replace(/[^A-Za-z0-9]/g, "").length < 3;
    if (isScrap) {
      carry = carry ? `${carry} ${seg.text}` : seg.text;
      continue;
    }
    merged.push({ ...seg, text: carry ? `${carry} ${seg.text}` : seg.text });
    carry = "";
  }
  // A trailing scrap has nowhere to go but the last segment.
  if (carry && merged.length) merged[merged.length - 1].text += ` ${carry}`;
  else if (carry) merged.push({ text: carry, at: null });

  return merged;
}

export async function POST(req: Request) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "OPENROUTER_API_KEY not set" }, { status: 500 });
  }

  const { image, mermaid, log, labels } = await req.json();
  if (typeof image !== "string" || !image.startsWith("data:image/")) {
    return NextResponse.json({ error: "expected a data: image URL" }, { status: 400 });
  }

  const context = [
    mermaid ? `The diagram as mermaid:\n${mermaid}` : "",
    Array.isArray(labels) && labels.length
      ? `Labels you may point at: ${labels.join(", ")}`
      : "",
    typeof log === "string" && log.trim()
      ? `What they did and said while drawing it:\n${log}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `${PROMPT}\n\n${context}` },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return NextResponse.json({ error: `openrouter ${res.status}`, detail }, { status: 502 });
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content?.trim() ?? "";
  return NextResponse.json({ raw, segments: parseSegments(raw) });
}

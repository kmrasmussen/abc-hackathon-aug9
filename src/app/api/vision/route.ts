import { NextResponse } from "next/server";

const MODEL = "google/gemma-4-31b-it";

const TASK = `Describe the diagram in one or two sentences.

Then express it as Mermaid, wrapped in tags exactly like this:

<mermaiddiagram>
flowchart TD
  A[Label] --> B[Other label]
</mermaiddiagram>

Rules for the Mermaid code:
- Use "flowchart TD" (or "flowchart LR" if the drawing reads left-to-right).
- One node per shape; use the text written inside the shape as its label.
- Use --> for arrows, following the direction drawn.
- Node ids must be simple alphanumeric (A, B, C, N1...). Put labels in brackets.
- Output only valid Mermaid inside the tags. No comments, no markdown fences.

Finally, locate every node AND every arrow on the image. Use box_2d as
[ymin, xmin, ymax, xmax] normalized to a 1000x1000 grid.

- For a node, set "label" to exactly the node label you used in the Mermaid.
- For an arrow, set "label" to "<from> -> <to>" using those same node labels,
  and box the whole arrow including its shaft, not just the head.

Wrap it in tags exactly like this:

<boxes>
[{"box_2d": [100, 200, 300, 400], "label": "Label"},
 {"box_2d": [300, 200, 500, 400], "label": "Label -> Other"}]
</boxes>

Output only JSON inside the boxes tags.`;

const FIRST = `This is a rough hand-drawn diagram on a white canvas.\n\n${TASK}`;

/**
 * Follow-up turns show the model its own previous answer, then the updated
 * drawing — so it reasons about what changed instead of re-reading from
 * scratch. That keeps node ids and labels stable between runs.
 */
const AGAIN = `This is the same drawing, updated since your last answer.

Work out what changed and update your answer to match. Keep the node ids and
labels you used before wherever the drawing still supports them — only rename
or renumber when the drawing clearly contradicts what you had. Re-state the
full answer for the whole diagram, not just the changed part.

${TASK}`;

/** Pull node boxes out of the <boxes> tags, converting to 0-1 coords. */
function extractBoxes(text: string) {
  const m = text.match(/<boxes>([\s\S]*?)<\/boxes>/i);
  if (!m) return [];
  const json = m[1].replace(/```(?:json)?/gi, "").trim();
  try {
    const items = JSON.parse(json) as { box_2d: number[]; label: string }[];
    return items
      .filter((it) => Array.isArray(it.box_2d) && it.box_2d.length === 4)
      .map((it) => {
        const [ymin, xmin, ymax, xmax] = it.box_2d;
        return {
          label: String(it.label),
          x: xmin / 1000,
          y: ymin / 1000,
          w: (xmax - xmin) / 1000,
          h: (ymax - ymin) / 1000,
        };
      });
  } catch {
    return [];
  }
}

/** Pull the mermaid source out of the tags, tolerating stray markdown fences. */
function extractMermaid(text: string): { prose: string; mermaid: string | null } {
  const m = text.match(/<mermaiddiagram>([\s\S]*?)<\/mermaiddiagram>/i);
  if (!m) return { prose: text.trim(), mermaid: null };

  const mermaid = m[1].replace(/```(?:mermaid)?/gi, "").trim();
  const prose = text
    .replace(m[0], "")
    .replace(/<boxes>[\s\S]*?<\/boxes>/i, "")
    .trim();
  return { prose, mermaid: mermaid || null };
}

type Turn = { image: string; reply: string };

export async function POST(req: Request) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "OPENROUTER_API_KEY not set" }, { status: 500 });
  }

  const { image, history } = await req.json();
  if (typeof image !== "string" || !image.startsWith("data:image/")) {
    return NextResponse.json({ error: "expected a data: image URL" }, { status: 400 });
  }

  // Keep only the most recent prior turn — enough to see the delta without
  // paying for every image ever drawn.
  const prior: Turn[] = Array.isArray(history) ? history.slice(-1) : [];

  const messages: unknown[] = [];
  for (const turn of prior) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: FIRST },
        { type: "image_url", image_url: { url: turn.image } },
      ],
    });
    messages.push({ role: "assistant", content: turn.reply });
  }
  messages.push({
    role: "user",
    content: [
      { type: "text", text: prior.length ? AGAIN : FIRST },
      { type: "image_url", image_url: { url: image } },
    ],
  });

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 900 }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return NextResponse.json({ error: `openrouter ${res.status}`, detail }, { status: 502 });
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content?.trim() ?? "";
  const { prose, mermaid } = extractMermaid(raw);
  const boxes = extractBoxes(raw);

  return NextResponse.json({
    text: prose || raw,
    mermaid,
    boxes,
    raw,
    incremental: prior.length > 0,
  });
}

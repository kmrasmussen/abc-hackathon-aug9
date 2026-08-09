import { NextResponse } from "next/server";
import { parseMermaidNodes } from "@/lib/mermaid-nodes";

const MODEL = "moondream3.1-9B-A2B";

type Box = { x_min: number; y_min: number; x_max: number; y_max: number };

/** Ask Moondream where a given label sits on the drawing. */
async function locate(key: string, image: string, label: string) {
  const res = await fetch("https://api.moondream.ai/v1/detect", {
    method: "POST",
    headers: { "X-Moondream-Auth": key, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, image_url: image, object: label }),
  });
  if (!res.ok) return { boxes: [] as Box[] };
  const data = await res.json();
  return { boxes: (data?.objects ?? []) as Box[] };
}

export async function POST(req: Request) {
  const key = process.env.MOONDREAM_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "MOONDREAM_API_KEY not set" }, { status: 500 });
  }

  const { image, mermaid } = await req.json();
  if (typeof image !== "string" || !image.startsWith("data:image/")) {
    return NextResponse.json({ error: "expected a data: image URL" }, { status: 400 });
  }
  if (typeof mermaid !== "string" || !mermaid.trim()) {
    return NextResponse.json({ error: "no mermaid code to map" }, { status: 400 });
  }

  const nodes = parseMermaidNodes(mermaid);
  if (!nodes.length) {
    return NextResponse.json({ nodes: [], warning: "no labelled nodes found in the mermaid" });
  }

  const located = await Promise.all(
    nodes.map(async (n) => {
      const { boxes } = await locate(key, image, n.label);
      // A box covering nearly the whole canvas means "I didn't find it".
      const usable = boxes.filter((b) => (b.x_max - b.x_min) * (b.y_max - b.y_min) < 0.6);
      const b = usable[0];
      return {
        id: n.id,
        label: n.label,
        found: Boolean(b),
        ...(b
          ? { x: b.x_min, y: b.y_min, w: b.x_max - b.x_min, h: b.y_max - b.y_min }
          : {}),
      };
    }),
  );

  return NextResponse.json({ nodes: located });
}

import { NextResponse } from "next/server";
import { parseMermaidNodes } from "@/lib/mermaid-nodes";
import { parseMermaidEdges } from "@/lib/mermaid-edges";

const MODEL = "moondream3.1-9B-A2B";

type Box = { x_min: number; y_min: number; x_max: number; y_max: number };
type Rect = { x: number; y: number; w: number; h: number };

async function detect(key: string, image: string, object: string): Promise<Box[]> {
  const res = await fetch("https://api.moondream.ai/v1/detect", {
    method: "POST",
    headers: { "X-Moondream-Auth": key, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, image_url: image, object }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data?.objects ?? []) as Box[];
}

const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

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

  const parsedNodes = parseMermaidNodes(mermaid);
  const parsedEdges = parseMermaidEdges(mermaid);

  // Locate each node by its label, and all arrowheads in one extra call.
  const [nodeResults, arrowBoxes] = await Promise.all([
    Promise.all(
      parsedNodes.map(async (n) => {
        const boxes = await detect(key, image, n.label);
        // A box covering most of the canvas means "I didn't find it".
        const usable = boxes.filter(
          (b) => (b.x_max - b.x_min) * (b.y_max - b.y_min) < 0.6,
        );
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
    ),
    detect(key, image, "arrow"),
  ]);

  const arrows: Rect[] = arrowBoxes
    .filter((b) => (b.x_max - b.x_min) * (b.y_max - b.y_min) < 0.6)
    .map((b) => ({ x: b.x_min, y: b.y_min, w: b.x_max - b.x_min, h: b.y_max - b.y_min }));

  /**
   * Moondream marks arrowheads, which sit at an edge's destination. Assign each
   * arrowhead to the mermaid edge whose target node is nearest, so every arrow
   * is claimed at most once.
   */
  const placed = new Map<string, Rect>();
  const byId = new Map(nodeResults.filter((n) => n.found).map((n) => [n.id, n as Required<typeof n>]));
  const taken = new Set<number>();

  for (const e of parsedEdges) {
    const target = byId.get(e.to);
    if (!target) continue;
    const tc = centre(target);

    let best = -1;
    let bestD = Infinity;
    arrows.forEach((a, i) => {
      if (taken.has(i)) return;
      const d = dist(centre(a), tc);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });

    // Only claim an arrowhead that is plausibly near its target node.
    if (best >= 0 && bestD < 0.35) {
      taken.add(best);
      placed.set(`${e.from}->${e.to}`, arrows[best]);
    }
  }

  const edges = parsedEdges.map((e) => {
    const r = placed.get(`${e.from}->${e.to}`);
    return {
      from: e.from,
      to: e.to,
      found: Boolean(r),
      ...(r ? { x: r.x, y: r.y, w: r.w, h: r.h } : {}),
    };
  });

  return NextResponse.json({
    nodes: nodeResults,
    edges,
    arrowsDetected: arrows.length,
  });
}

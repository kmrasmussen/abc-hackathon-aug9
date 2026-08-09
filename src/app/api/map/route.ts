import { NextResponse } from "next/server";
import { parseMermaidNodes } from "@/lib/mermaid-nodes";
import { parseMermaidEdges } from "@/lib/mermaid-edges";

const MODEL = "moondream3.1-9B-A2B";
const GEMMA = "google/gemma-4-31b-it";

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

/**
 * Gemma 3+ can detect directly: it returns box_2d as [ymin, xmin, ymax, xmax]
 * on a 1000x1000 grid. One call covers every label, unlike Moondream's
 * one-request-per-object.
 */
async function gemmaDetect(
  key: string,
  image: string,
  labels: string[],
): Promise<Map<string, Rect>> {
  const out = new Map<string, Rect>();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GEMMA,
      max_tokens: 600,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Detect these elements in the diagram: ${labels.join(", ")}. Return only JSON.`,
            },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) return out;
  const data = await res.json();
  const text: string = data?.choices?.[0]?.message?.content ?? "";
  const json = text.match(/\[[\s\S]*\]/);
  if (!json) return out;
  try {
    const items = JSON.parse(json[0]) as { box_2d: number[]; label: string }[];
    for (const it of items) {
      if (!Array.isArray(it.box_2d) || it.box_2d.length !== 4) continue;
      const [ymin, xmin, ymax, xmax] = it.box_2d;
      out.set(String(it.label).toLowerCase(), {
        x: xmin / 1000,
        y: ymin / 1000,
        w: (xmax - xmin) / 1000,
        h: (ymax - ymin) / 1000,
      });
    }
  } catch {
    // malformed json — fall through with whatever parsed
  }
  return out;
}

/** /point returns centre points (0–1 coords) rather than boxes. */
async function point(
  key: string,
  image: string,
  object: string,
): Promise<{ x: number; y: number }[]> {
  const res = await fetch("https://api.moondream.ai/v1/point", {
    method: "POST",
    headers: { "X-Moondream-Auth": key, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, image_url: image, object }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data?.points ?? []) as { x: number; y: number }[];
}

/**
 * /segment returns a single SVG path (0–1 coords) plus its bbox — an outline
 * of the thing rather than a rectangle. One object per call, and noticeably
 * slower than /detect.
 */
async function segment(
  key: string,
  image: string,
  object: string,
): Promise<{ path: string; bbox: Box } | null> {
  const res = await fetch("https://api.moondream.ai/v1/segment", {
    method: "POST",
    headers: { "X-Moondream-Auth": key, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, image_url: image, object }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.path || !data?.bbox || data?.parse_error) return null;
  return { path: data.path as string, bbox: data.bbox as Box };
}

const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

export async function POST(req: Request) {
  const key = process.env.MOONDREAM_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "MOONDREAM_API_KEY not set" }, { status: 500 });
  }

  const { image, mermaid, mode } = await req.json();
  const useSegment = mode === "segment";
  const usePoint = mode === "point";
  const useGemma = mode === "gemma";
  if (typeof image !== "string" || !image.startsWith("data:image/")) {
    return NextResponse.json({ error: "expected a data: image URL" }, { status: 400 });
  }
  if (typeof mermaid !== "string" || !mermaid.trim()) {
    return NextResponse.json({ error: "no mermaid code to map" }, { status: 400 });
  }

  const parsedNodes = parseMermaidNodes(mermaid);
  const parsedEdges = parseMermaidEdges(mermaid);

  // Gemma detects every label in a single call, so handle it up front.
  if (useGemma) {
    const orKey = process.env.OPENROUTER_API_KEY;
    if (!orKey) {
      return NextResponse.json({ error: "OPENROUTER_API_KEY not set" }, { status: 500 });
    }
    const found = await gemmaDetect(orKey, image, parsedNodes.map((n) => n.label));
    const nodes = parsedNodes.map((n) => {
      const r = found.get(n.label.toLowerCase());
      return {
        id: n.id,
        label: n.label,
        found: Boolean(r),
        ...(r ? { x: r.x, y: r.y, w: r.w, h: r.h } : {}),
      };
    });
    return NextResponse.json({
      nodes,
      edges: parsedEdges.map((e) => ({ from: e.from, to: e.to, found: false })),
      arrowsDetected: 0,
    });
  }

  // Locate each node by its label, and all arrowheads in one extra call.
  const [nodeResults, arrowBoxes] = await Promise.all([
    Promise.all(
      parsedNodes.map(async (n) => {
        if (usePoint) {
          const pts = await point(key, image, n.label);
          const p = pts[0];
          // A point has no extent, so give it a small box for prompting.
          const R = 0.02;
          return {
            id: n.id,
            label: n.label,
            found: Boolean(p),
            ...(p
              ? { x: p.x - R, y: p.y - R, w: R * 2, h: R * 2, px: p.x, py: p.y }
              : {}),
          };
        }

        if (useSegment) {
          const seg = await segment(key, image, n.label);
          const b = seg?.bbox;
          const big = b && (b.x_max - b.x_min) * (b.y_max - b.y_min) >= 0.6;
          return {
            id: n.id,
            label: n.label,
            found: Boolean(b) && !big,
            ...(b && !big
              ? {
                  x: b.x_min,
                  y: b.y_min,
                  w: b.x_max - b.x_min,
                  h: b.y_max - b.y_min,
                  path: seg?.path,
                }
              : {}),
          };
        }

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

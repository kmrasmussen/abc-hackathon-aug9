import { NextResponse } from "next/server";

const MODEL = "moondream3.1-9B-A2B";

/** Shapes we look for in a hand-drawn diagram. */
const OBJECTS = ["circle", "arrow", "square", "triangle", "line"];

type Box = { x_min: number; y_min: number; x_max: number; y_max: number };

async function detectOne(key: string, image: string, object: string) {
  const res = await fetch("https://api.moondream.ai/v1/detect", {
    method: "POST",
    headers: { "X-Moondream-Auth": key, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, image_url: image, object }),
  });
  if (!res.ok) return { object, boxes: [] as Box[], error: `${res.status}` };
  const data = await res.json();
  return { object, boxes: (data?.objects ?? []) as Box[] };
}

export async function POST(req: Request) {
  const key = process.env.MOONDREAM_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "MOONDREAM_API_KEY not set" }, { status: 500 });
  }

  const { image, objects } = await req.json();
  if (typeof image !== "string" || !image.startsWith("data:image/")) {
    return NextResponse.json({ error: "expected a data: image URL" }, { status: 400 });
  }

  const wanted: string[] = Array.isArray(objects) && objects.length ? objects : OBJECTS;

  // Moondream detects one object class per call, so fan out.
  const results = await Promise.all(wanted.map((o) => detectOne(key, image, o)));

  const shapes = results.flatMap((r) =>
    r.boxes.map((b) => ({
      label: r.object,
      x: b.x_min,
      y: b.y_min,
      w: b.x_max - b.x_min,
      h: b.y_max - b.y_min,
    })),
  );

  return NextResponse.json({ shapes });
}

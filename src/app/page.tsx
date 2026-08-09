"use client";

import { useEffect, useRef, useState } from "react";
import Mermaid from "./Mermaid";

/** A detected shape, in normalized 0–1 coordinates. */
type Shape = { label: string; x: number; y: number; w: number; h: number };

/** A mermaid node located on the drawing. */
type MappedNode = {
  id: string;
  label: string;
  found: boolean;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** SVG outline in 0-1 coords, present in segment mode. */
  path?: string;
  /** Exact point in 0-1 coords, present in point mode. */
  px?: number;
  py?: number;
};

/** A mermaid edge located on the drawing (the arrowhead at its target). */
type MappedEdge = {
  from: string;
  to: string;
  found: boolean;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
};

/** Everything derived from one successfully-processed frame. */
type Committed = {
  /** The exact image this was computed from — the canvas has moved on since. */
  image: string;
  description: string;
  mermaid: string | null;
  boxes: { label: string; x: number; y: number; w: number; h: number }[];
  nodes: MappedNode[];
  edges: MappedEdge[];
  raw: string;
  at: number;
};

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const pointing = useRef(false);

  const [asking, setAsking] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [committed, setCommitted] = useState<Committed | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [tool, setTool] = useState<"point" | "draw" | "erase">("draw");
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [pointed, setPointed] = useState<{ x: number; y: number } | null>(null);
  const [auto, setAuto] = useState(true);
  const [countdown, setCountdown] = useState<number | null>(null);
  const historyRef = useRef<{ image: string; reply: string }[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runIdRef = useRef(0);
  const [dumpText, setDumpText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);


  // Panels read the committed frame, not the live canvas.
  const capture = committed?.image ?? null;
  const answer = runError ?? committed?.description ?? null;
  const mermaid = committed?.mermaid ?? null;
  const nodes = committed?.nodes ?? null;
  const edges = committed?.edges ?? null;
  const visionBoxes = committed?.boxes ?? [];
  const rawReply = committed?.raw ?? null;

  const ctxOf = () => canvasRef.current?.getContext("2d") ?? null;

  const styleCtx = (ctx: CanvasRenderingContext2D) => {
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  };

  /**
   * The canvas fills its column, so size the backing store to the rendered box.
   * Resizing clears the bitmap, so redraw the white ground and restore stroke style.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const resize = () => {
      const { width, height } = wrap.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      const dpr = window.devicePixelRatio || 1;
      const prev = canvas.width > 0 ? canvas.toDataURL() : null;

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      styleCtx(ctx);

      // Keep whatever was already drawn across a resize.
      if (prev) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, width, height);
        img.src = prev;
      }
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const posOf = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const ERASER_R = 28;

  /** Erase by painting white — the canvas is opaque white, so this reads as rubbing out. */
  const eraseAt = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, ERASER_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = ctxOf();
    if (!ctx) return;
    const p = posOf(e);

    // Pointing doesn't modify the canvas; it marks a spot and follows the drag.
    if (tool === "point") {
      e.currentTarget.setPointerCapture(e.pointerId);
      pointing.current = true;
      const rect = e.currentTarget.getBoundingClientRect();
      setPointed({ x: p.x / rect.width, y: p.y / rect.height });
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;

    if (tool === "erase") {
      eraseAt(ctx, p.x, p.y);
      return;
    }

    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = posOf(e);
    if (tool === "erase") setCursor(p);

    if (tool === "point") {
      if (!pointing.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      setPointed({ x: p.x / rect.width, y: p.y / rect.height });
      return;
    }

    if (!drawing.current) return;
    const ctx = ctxOf();
    if (!ctx) return;

    if (tool === "erase") {
      eraseAt(ctx, p.x, p.y);
      return;
    }

    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const DEBOUNCE_MS = 5000;

  /** Restart the idle timer; the run only fires after a full quiet period. */
  const scheduleRun = () => {
    if (!auto) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setCountdown(DEBOUNCE_MS / 1000);
    debounceRef.current = setTimeout(() => {
      setCountdown(null);
      const canvas = canvasRef.current;
      if (!canvas) return;
      runVision(canvas.toDataURL("image/png"));
    }, DEBOUNCE_MS);
  };

  const stop = () => {
    pointing.current = false;
    if (drawing.current) scheduleRun();
    drawing.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = ctxOf();
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    styleCtx(ctx);
  };

  /**
   * Send one frame to Gemma. The committed result is only replaced when a run
   * succeeds, so the previous processed state stays visible and addressable
   * for the multiple seconds a request can take.
   */
  const runVision = async (img: string) => {
    const myRun = ++runIdRef.current;
    setAsking(true);
    try {
      const res = await fetch("/api/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: img, history: historyRef.current }),
      });
      const data = await res.json();
      // A newer run started while this was in flight — drop this result.
      if (myRun !== runIdRef.current) return;

      if (!res.ok) {
        setRunError(`error: ${data.error ?? res.status}`);
        return;
      }
      setRunError(null);

      type VB = { label: string; x: number; y: number; w: number; h: number };
      const boxes: VB[] = data.boxes ?? [];
      // Arrow boxes are labelled "from -> to"; nodes are everything else.
      const arrowBoxes = boxes.filter((b) => b.label.includes("->"));
      const nodeBoxes = boxes.filter((b) => !b.label.includes("->"));

      setCommitted({
        image: img,
        description: data.text ?? "",
        mermaid: data.mermaid ?? null,
        boxes,
        nodes: nodeBoxes.map((b, i) => ({
          id: String.fromCharCode(65 + i),
          label: b.label,
          found: true,
          x: b.x,
          y: b.y,
          w: b.w,
          h: b.h,
        })),
        edges: arrowBoxes.map((b) => {
          const [from, to] = b.label.split("->").map((t) => t.trim());
          return { from, to, found: true, x: b.x, y: b.y, w: b.w, h: b.h };
        }),
        raw: data.raw ?? "",
        at: Date.now(),
      });

      if (data.raw) historyRef.current = [{ image: img, reply: data.raw }];
    } catch (err) {
      if (myRun === runIdRef.current) setRunError(`error: ${String(err)}`);
    } finally {
      if (myRun === runIdRef.current) setAsking(false);
    }
  };

  /** Everything the committed frame holds, as plain text to paste into a chat. */
  const dump = () => {
    const L: string[] = [];
    const n = (v: number | undefined) => (v === undefined ? "?" : v.toFixed(3));
    L.push("=== PROMPT DUMP ===");
    L.push(
      committed
        ? `committed ${new Date(committed.at).toLocaleTimeString()}${asking ? " (newer run in flight)" : ""}`
        : "nothing committed yet",
    );
    L.push("");
    L.push("--- gemma description ---");
    L.push(committed?.description || "(none)");
    L.push("");
    L.push("--- gemma raw reply ---");
    L.push(committed?.raw || "(none)");
    L.push("");
    L.push("--- mermaid ---");
    L.push(committed?.mermaid || "(none)");
    L.push("");
    L.push(`--- nodes (${committed?.nodes.length ?? 0}) ---`);
    for (const nd of committed?.nodes ?? [])
      L.push(`${nd.id}[${nd.label}]  x=${n(nd.x)} y=${n(nd.y)} w=${n(nd.w)} h=${n(nd.h)}`);
    L.push("");
    L.push(`--- edges (${committed?.edges.length ?? 0}) ---`);
    for (const e of committed?.edges ?? [])
      L.push(`${e.from} -> ${e.to}   x=${n(e.x)} y=${n(e.y)} w=${n(e.w)} h=${n(e.h)}`);
    return L.join("\n");
  };

  const onDump = async () => {
    const text = dump();
    setDumpText(text);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — the textarea below is the fallback
    }
  };

  /** Manual trigger — same path as the debounced one. */
  const onShowToLlm = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setCountdown(null);
    runVision(canvas.toDataURL("image/png"));
  };

  const label = "text-xs uppercase tracking-widest text-neutral-500";

  return (
    <main className="grid h-screen grid-cols-2 gap-4 overflow-hidden bg-white p-4 text-black">
      {/* left — the drawing surface, a square as large as the column allows */}
      <section className="flex min-h-0 flex-col gap-2">
        <div className="flex shrink-0 items-center gap-2">
          <h2 className={label}>Draw</h2>
          <div className="flex gap-1">
            {(["point", "draw", "erase"] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTool(t);
                  if (t !== "point") setPointed(null);
                  if (t !== "erase") setCursor(null);
                }}
                className={`rounded-md border-2 px-2.5 py-1 text-xs font-medium transition-colors ${
                  tool === t
                    ? "border-black bg-black text-white"
                    : "border-neutral-300 text-neutral-600 hover:bg-neutral-100"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 items-start justify-center">
          <div
            ref={wrapRef}
            className="relative aspect-square h-full max-w-full overflow-hidden rounded-lg border-2 border-black"
            style={{ maxHeight: "100%" }}
          >
            <canvas
              ref={canvasRef}
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={stop}
              onPointerCancel={stop}
              onPointerLeave={() => {
                setCursor(null);
                stop();
              }}
              className={`block h-full w-full touch-none bg-white ${
                tool === "erase" ? "cursor-none" : "cursor-crosshair"
              }`}
            />
            {/* committed boxes, ghosted onto the live canvas */}
            {committed && (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                {committed.nodes.map((n) => (
                  <rect
                    key={`gn${n.id}`}
                    x={(n.x ?? 0) * 100}
                    y={(n.y ?? 0) * 100}
                    width={(n.w ?? 0) * 100}
                    height={(n.h ?? 0) * 100}
                    fill="#2563eb"
                    fillOpacity={0.04}
                    stroke="#2563eb"
                    strokeOpacity={0.28}
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {committed.edges.map((e) => (
                  <rect
                    key={`ge${e.from}${e.to}`}
                    x={(e.x ?? 0) * 100}
                    y={(e.y ?? 0) * 100}
                    width={(e.w ?? 0) * 100}
                    height={(e.h ?? 0) * 100}
                    fill="#16a34a"
                    fillOpacity={0.04}
                    stroke="#16a34a"
                    strokeOpacity={0.22}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>
            )}
            {/* labels sit just outside each ghost box */}
            {committed?.nodes.map((n) => (
              <span
                key={`gl${n.id}`}
                className="pointer-events-none absolute text-[10px] font-medium leading-none text-blue-600/45"
                style={{
                  left: `${(n.x ?? 0) * 100}%`,
                  top: `${(n.y ?? 0) * 100}%`,
                  transform: "translateY(-115%)",
                }}
              >
                {n.label}
              </span>
            ))}

            {/* eraser ring follows the pointer so its size is visible */}
            {tool === "erase" && cursor && (
              <div
                className="pointer-events-none absolute rounded-full border-2 border-neutral-400"
                style={{
                  left: cursor.x - 28,
                  top: cursor.y - 28,
                  width: 56,
                  height: 56,
                }}
              />
            )}
            {pointed && (
              <div
                className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fuchsia-600 ring-2 ring-white"
                style={{ left: `${pointed.x * 100}%`, top: `${pointed.y * 100}%` }}
              />
            )}
          </div>
        </div>
      </section>

      {/* right — all controls on top, then captured still, then the answer */}
      <section className="flex min-h-0 flex-col gap-2">
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            onClick={clear}
            className="rounded-md border-2 border-black px-3 py-1.5 text-sm text-black transition-colors hover:bg-neutral-100"
          >
            Clear
          </button>
          <label className="flex cursor-pointer items-center gap-1.5 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => {
                setAuto(e.target.checked);
                if (!e.target.checked && debounceRef.current) {
                  clearTimeout(debounceRef.current);
                  setCountdown(null);
                }
              }}
              className="h-4 w-4 accent-black"
            />
            auto
          </label>
          {countdown !== null && (
            <span className="text-xs text-neutral-500">running in {countdown}s…</span>
          )}
          <button
            onClick={onShowToLlm}
            disabled={asking}
            className="rounded-md bg-black px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {asking ? "Looking…" : "Run now"}
          </button>
          <button
            onClick={onDump}
            className="rounded-md border-2 border-dashed border-neutral-400 px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100"
          >
            {copied ? "Copied ✓" : "Prompt dump"}
          </button>
        </div>

        {dumpText !== null && (
          <div className="shrink-0">
            <div className="mb-1 flex items-center gap-2">
              <span className={label}>Prompt dump</span>
              <button
                onClick={() => setDumpText(null)}
                className="text-[10px] text-neutral-500 underline hover:text-black"
              >
                hide
              </button>
            </div>
            <textarea
              readOnly
              value={dumpText}
              onFocus={(e) => e.currentTarget.select()}
              className="h-40 w-full resize-y rounded-lg border-2 border-dashed border-neutral-400 bg-neutral-50 p-2 font-mono text-[11px] leading-snug text-black"
            />
          </div>
        )}

        <h2 className={`${label} flex shrink-0 items-center gap-2`}>
          <span>Committed</span>
          {committed && (
            <>
              <span className="normal-case tracking-normal text-blue-600">
                {committed.nodes.length} node{committed.nodes.length === 1 ? "" : "s"}
              </span>
              <span className="normal-case tracking-normal text-green-600">
                {committed.edges.length} edge{committed.edges.length === 1 ? "" : "s"}
              </span>
              <span className="normal-case tracking-normal text-neutral-400">
                {new Date(committed.at).toLocaleTimeString()}
              </span>
            </>
          )}
          {asking && (
            <span className="normal-case tracking-normal text-fuchsia-600">updating…</span>
          )}
        </h2>
        <div className="flex min-h-0 flex-1 items-start justify-center">
          {committed ? (
            <div className="relative aspect-square h-full max-w-full overflow-hidden rounded-lg border-2 border-black bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={committed.image}
                alt="committed frame"
                className="block h-full w-full object-contain"
              />
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                {committed.nodes.map((n) => (
                  <rect
                    key={`n${n.id}`}
                    x={(n.x ?? 0) * 100}
                    y={(n.y ?? 0) * 100}
                    width={(n.w ?? 0) * 100}
                    height={(n.h ?? 0) * 100}
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {committed.edges.map((e) => (
                  <rect
                    key={`e${e.from}${e.to}`}
                    x={(e.x ?? 0) * 100}
                    y={(e.y ?? 0) * 100}
                    width={(e.w ?? 0) * 100}
                    height={(e.h ?? 0) * 100}
                    fill="none"
                    stroke="#16a34a"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>
              {committed.nodes.map((n) => (
                <span
                  key={`nl${n.id}`}
                  className="pointer-events-none absolute rounded bg-blue-600 px-1 text-[10px] font-medium leading-tight text-white"
                  style={{
                    left: `${(n.x ?? 0) * 100}%`,
                    top: `${(n.y ?? 0) * 100}%`,
                    transform: "translateY(-100%)",
                  }}
                >
                  {n.label}
                </span>
              ))}
            </div>
          ) : (
            <div className="flex aspect-square h-full max-w-full items-center justify-center rounded-lg border-2 border-black bg-white">
              <span className="text-sm text-neutral-400">
                {asking ? "processing…" : "draw something"}
              </span>
            </div>
          )}
        </div>

        <h2 className={`${label} shrink-0`}>LLM sees</h2>
        <div className="max-h-28 shrink-0 overflow-auto rounded-lg border-2 border-black bg-white p-3">
          {answer ? (
            <p className="text-sm leading-relaxed text-black">{answer}</p>
          ) : (
            <span className="text-sm text-neutral-400">{asking ? "asking gemma…" : "no answer yet"}</span>
          )}
        </div>

        <h2 className={`${label} flex shrink-0 items-center gap-3`}>
          <span>Diagram</span>
          {mermaid && (
            <button
              onClick={() => setShowCode((v) => !v)}
              className="rounded border border-neutral-400 px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-neutral-600 transition-colors hover:bg-neutral-100"
            >
              {showCode ? "show diagram" : "show code"}
            </button>
          )}
        </h2>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border-2 border-black bg-white p-3">
          {mermaid ? (
            showCode ? (
              <pre className="whitespace-pre-wrap text-xs leading-relaxed text-black">{mermaid}</pre>
            ) : (
              <Mermaid code={mermaid} />
            )
          ) : (
            <span className="text-sm text-neutral-400">
              {asking ? "…" : "no diagram yet"}
            </span>
          )}
        </div>
      </section>
    </main>
  );
}

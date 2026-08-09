"use client";

import { useEffect, useRef, useState } from "react";
import Mermaid from "./Mermaid";
import { useSam } from "./useSam";

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

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);

  const [capture, setCapture] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [mermaid, setMermaid] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [shapes, setShapes] = useState<Shape[] | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [nodes, setNodes] = useState<MappedNode[] | null>(null);
  const [edges, setEdges] = useState<MappedEdge[] | null>(null);
  const [mapping, setMapping] = useState(false);
  const [mapMode, setMapMode] = useState<"detect" | "point" | "segment" | "gemma">("detect");
  const [visionBoxes, setVisionBoxes] = useState<
    { label: string; x: number; y: number; w: number; h: number }[]
  >([]);
  const [rawReply, setRawReply] = useState<string | null>(null);
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

  // in-browser SAM: click a stroke to segment it, each mask gets its own colour
  const sam = useSam();
  const [masks, setMasks] = useState<{ url: string; color: string; label: string }[]>([]);
  const [segBusy, setSegBusy] = useState(false);

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

    // Pointing doesn't modify the canvas; it just marks a spot.
    if (tool === "point") {
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

    if (!drawing.current) return;
    const ctx = ctxOf();
    if (!ctx) return;

    if (tool === "erase") {
      eraseAt(ctx, p.x, p.y);
      return;
    }
    if (tool === "point") return;

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

  const onCapture = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setCapture(canvas.toDataURL("image/png"));
    setAnswer(null);
    setMermaid(null);
    setShapes(null);
    setNodes(null);
    setEdges(null);
    setMasks([]);
    setVisionBoxes([]);
    sam.reset();
  };

  const onDetect = async () => {
    if (!capture) return;
    setDetecting(true);
    setShapes(null);
    try {
      const res = await fetch("/api/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: capture }),
      });
      const data = await res.json();
      if (res.ok) setShapes(data.shapes ?? []);
      else setAnswer(`detect error: ${data.error ?? res.status}`);
    } catch (err) {
      setAnswer(`detect error: ${String(err)}`);
    } finally {
      setDetecting(false);
    }
  };

  const onMap = async () => {
    if (!capture || !mermaid) return;
    setMapping(true);
    setNodes(null);
    setEdges(null);
    try {
      const res = await fetch("/api/map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: capture, mermaid, mode: mapMode }),
      });
      const data = await res.json();
      if (res.ok) {
        setNodes(data.nodes ?? []);
        setEdges(data.edges ?? []);
      } else setAnswer(`map error: ${data.error ?? res.status}`);
    } catch (err) {
      setAnswer(`map error: ${String(err)}`);
    } finally {
      setMapping(false);
    }
  };

  const GLOW = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#14b8a6"];

  /** Turn a SAM mask into a coloured PNG that can be layered over the image. */
  const maskToUrl = (
    grid: Uint8Array,
    w: number,
    h: number,
    color: string,
  ): string => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return "";
    const img = ctx.createImageData(w, h);
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    for (let i = 0; i < w * h; i++) {
      if (!grid[i]) continue;
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  };

  /**
   * Moondream bridge: each mermaid node already has a box from /api/map, so
   * prompt SAM with that box to get the node's exact pixels.
   */
  const onSam = async () => {
    if (!capture || segBusy) return;
    const located = (nodes ?? []).filter((n) => n.found);
    if (!located.length) return;

    setSegBusy(true);
    setMasks([]);
    try {
      if (sam.status !== "ready") {
        const ok = await sam.encode(capture);
        if (!ok) return;
      }
      const out: { url: string; color: string; label: string }[] = [];
      for (let i = 0; i < located.length; i++) {
        const n = located[i];
        const m =
          n.px !== undefined && n.py !== undefined
            ? await sam.segmentAt(n.px, n.py)
            : await sam.segmentBox(n.x ?? 0, n.y ?? 0, n.w ?? 0, n.h ?? 0);
        if (!m) continue;
        const color = GLOW[i % GLOW.length];
        const url = maskToUrl(m.grid, m.width, m.height, color);
        if (url) out.push({ url, color, label: n.label });
        setMasks([...out]);
      }
    } finally {
      setSegBusy(false);
    }
  };

  /** Everything the pipeline produced, as plain text to paste into a chat. */
  const dump = () => {
    const L: string[] = [];
    const n = (v: number | undefined) => (v === undefined ? "?" : v.toFixed(3));

    L.push("=== PROMPT DUMP ===");
    L.push(`captured: ${capture ? "yes" : "no"} | map mode: ${mapMode}`);
    L.push("");

    L.push("--- gemma description ---");
    L.push(answer ?? "(none)");
    L.push("");

    L.push("--- gemma raw reply ---");
    L.push(rawReply ?? "(none)");
    L.push("");

    L.push("--- mermaid ---");
    L.push(mermaid ?? "(none)");
    L.push("");

    L.push(`--- gemma boxes (same call as mermaid): ${visionBoxes.length} ---`);
    for (const b of visionBoxes)
      L.push(`${b.label}  x=${n(b.x)} y=${n(b.y)} w=${n(b.w)} h=${n(b.h)}`);
    L.push("");

    L.push("--- parsed nodes -> located on drawing ---");
    if (!nodes) {
      L.push("(not mapped yet)");
    } else if (!nodes.length) {
      L.push("(no labelled nodes parsed from the mermaid)");
    } else {
      for (const nd of nodes) {
        L.push(
          nd.found
            ? `${nd.id}[${nd.label}]  x=${n(nd.x)} y=${n(nd.y)} w=${n(nd.w)} h=${n(nd.h)}${nd.px !== undefined ? ` point=(${n(nd.px)},${n(nd.py)})` : ""}${nd.path ? ` path=${nd.path.length}chars` : ""}`
            : `${nd.id}[${nd.label}]  NOT FOUND`,
        );
      }
    }
    L.push("");

    L.push("--- edges (arrowhead at target) ---");
    if (!edges) L.push("(not mapped yet)");
    else if (!edges.length) L.push("(no edges parsed)");
    else
      for (const e of edges)
        L.push(
          e.found
            ? `${e.from} -> ${e.to}   x=${n(e.x)} y=${n(e.y)} w=${n(e.w)} h=${n(e.h)}`
            : `${e.from} -> ${e.to}   NOT LOCATED`,
        );
    L.push("");

    L.push("--- generic shape detection ---");
    if (!shapes) L.push("(not run)");
    else if (!shapes.length) L.push("(none found)");
    else
      for (const s of shapes)
        L.push(`${s.label}  x=${n(s.x)} y=${n(s.y)} w=${n(s.w)} h=${n(s.h)}`);

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

  /** Send one frame to Gemma, with the previous turn as conversation history. */
  const runVision = async (img: string) => {
    const myRun = ++runIdRef.current;
    setCapture(img);
    setAsking(true);
    setAnswer(null);
    setMermaid(null);
    setNodes(null);
    setEdges(null);
    setVisionBoxes([]);
    try {
      const res = await fetch("/api/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: img, history: historyRef.current }),
      });
      const data = await res.json();
      // A newer run started while this was in flight — drop this result.
      if (myRun !== runIdRef.current) return;

      setAnswer(res.ok ? data.text : `error: ${data.error ?? res.status}`);
      if (!res.ok) return;

      setMermaid(data.mermaid ?? null);
      setRawReply(data.raw ?? null);

      if (data.raw) {
        historyRef.current = [{ image: img, reply: data.raw }];
      }

      type VB = { label: string; x: number; y: number; w: number; h: number };
      const vb: VB[] = data.boxes ?? [];
      setVisionBoxes(vb);
      if (vb.length) {
        const arrowBoxes = vb.filter((b) => b.label.includes("->"));
        const nodeBoxes = vb.filter((b) => !b.label.includes("->"));
        setNodes(
          nodeBoxes.map((b, i) => ({
            id: String.fromCharCode(65 + i),
            label: b.label,
            found: true,
            x: b.x,
            y: b.y,
            w: b.w,
            h: b.h,
          })),
        );
        if (arrowBoxes.length) {
          setEdges(
            arrowBoxes.map((b) => {
              const [from, to] = b.label.split("->").map((t) => t.trim());
              return { from, to, found: true, x: b.x, y: b.y, w: b.w, h: b.h };
            }),
          );
        }
      }
    } catch (err) {
      if (myRun === runIdRef.current) setAnswer(`error: ${String(err)}`);
    } finally {
      if (myRun === runIdRef.current) setAsking(false);
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
            onClick={onCapture}
            className="rounded-md bg-black px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-80"
          >
            Capture
          </button>
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
            onClick={onDetect}
            disabled={!capture || detecting}
            className="rounded-md border-2 border-black px-3 py-1.5 text-sm font-medium text-black transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {detecting ? "Detecting…" : "Detect shapes"}
          </button>
          <button
            onClick={onMap}
            disabled={!capture || !mermaid || mapping}
            className="rounded-md border-2 border-black px-3 py-1.5 text-sm font-medium text-black transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {mapping ? "Mapping…" : "Map nodes to drawing"}
          </button>
          <select
            value={mapMode}
            onChange={(e) => setMapMode(e.target.value as "detect" | "point" | "segment" | "gemma")}
            className="rounded-md border-2 border-black px-2 py-1.5 text-sm text-black"
          >
            <option value="detect">detect (box)</option>
            <option value="point">point</option>
            <option value="segment">segment</option>
            <option value="gemma">gemma boxes</option>
          </select>
          <button
            onClick={onSam}
            disabled={!capture || segBusy || !(nodes ?? []).some((n) => n.found)}
            className="rounded-md border-2 border-fuchsia-600 px-3 py-1.5 text-sm font-medium text-fuchsia-700 transition-colors hover:bg-fuchsia-50 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {segBusy
              ? sam.status === "loading"
                ? "Loading SAM…"
                : sam.status === "encoding"
                  ? "Encoding…"
                  : "Segmenting…"
              : "SAM masks"}
          </button>
          {masks.length > 0 && (
            <span className="text-xs text-neutral-500">
              {masks.map((m) => (
                <span key={m.label} className="mr-1.5" style={{ color: m.color }}>
                  ●{m.label}
                </span>
              ))}
              <button onClick={() => setMasks([])} className="ml-2 underline hover:text-black">
                clear
              </button>
            </span>
          )}
          {sam.error && (
            <span className="text-xs text-rose-600">{sam.error.slice(0, 60)}</span>
          )}
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

        <h2 className={`${label} shrink-0`}>
          Captured
          {shapes && (
            <span className="ml-2 normal-case tracking-normal text-rose-600">
              {shapes.length} shape{shapes.length === 1 ? "" : "s"}
            </span>
          )}
          {nodes && (
            <span className="ml-2 normal-case tracking-normal text-blue-600">
              {nodes.filter((n) => n.found).length}/{nodes.length} nodes
              {nodes.some((n) => !n.found) && (
                <span className="ml-1 text-neutral-400">
                  (missing: {nodes.filter((n) => !n.found).map((n) => n.label).join(", ")})
                </span>
              )}
            </span>
          )}
          {edges && (
            <span className="ml-2 normal-case tracking-normal text-green-600">
              {edges.filter((e) => e.found).length}/{edges.length} edges
            </span>
          )}
        </h2>
        <div className="flex min-h-0 flex-1 items-start justify-center">
          {capture ? (
            <div className="relative aspect-square h-full max-w-full overflow-hidden rounded-lg border-2 border-black bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={capture} alt="captured drawing" className="block h-full w-full object-contain" />
              {/* SAM masks, drawn over the capture */}
              {masks.map((m, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`m${i}`}
                  src={m.url}
                  alt=""
                  className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-60"
                />
              ))}
              {shapes && shapes.length > 0 && (
                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                  {shapes.map((s, i) => (
                    <rect
                      key={i}
                      x={s.x * 100}
                      y={s.y * 100}
                      width={s.w * 100}
                      height={s.h * 100}
                      fill="none"
                      stroke="#e11d48"
                      strokeWidth={0.4}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </svg>
              )}
              {shapes?.map((s, i) => (
                <span
                  key={`l${i}`}
                  className="pointer-events-none absolute rounded bg-rose-600 px-1 text-[10px] font-medium leading-tight text-white"
                  style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, transform: "translateY(-100%)" }}
                >
                  {s.label}
                </span>
              ))}

              {/* mermaid nodes located on the drawing */}
              {nodes && nodes.some((n) => n.found) && (
                <>
                  {/* outlines come back in 0-1 coords, so they need their own viewBox */}
                  <svg
                    className="pointer-events-none absolute inset-0 h-full w-full"
                    viewBox="0 0 1 1"
                    preserveAspectRatio="none"
                  >
                    {nodes
                      .filter((n) => n.found && n.path)
                      .map((n) => (
                        <path
                          key={`p${n.id}`}
                          d={n.path}
                          fill="#2563eb"
                          fillOpacity={0.15}
                          stroke="#2563eb"
                          strokeWidth={2}
                          vectorEffect="non-scaling-stroke"
                        />
                      ))}
                  </svg>
                  <svg
                    className="pointer-events-none absolute inset-0 h-full w-full"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                  >
                    {nodes
                      .filter((n) => n.found && !n.path)
                      .map((n) => (
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
                  </svg>
                </>
              )}
              {nodes
                ?.filter((n) => n.found)
                .map((n) => (
                  <span
                    key={`nl${n.id}`}
                    className="pointer-events-none absolute rounded bg-blue-600 px-1 text-[10px] font-medium leading-tight text-white"
                    style={{
                      left: `${(n.x ?? 0) * 100}%`,
                      top: `${(n.y ?? 0) * 100}%`,
                      transform: "translateY(-100%)",
                    }}
                  >
                    {n.id}: {n.label}
                  </span>
                ))}

              {/* edges: the arrowhead that marks each edge's target */}
              {edges && edges.some((e) => e.found) && (
                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                  {edges
                    .filter((e) => e.found)
                    .map((e) => (
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
              )}
              {edges
                ?.filter((e) => e.found)
                .map((e) => (
                  <span
                    key={`el${e.from}${e.to}`}
                    className="pointer-events-none absolute rounded bg-green-600 px-1 text-[9px] font-medium leading-tight text-white"
                    style={{
                      left: `${(e.x ?? 0) * 100}%`,
                      top: `${((e.y ?? 0) + (e.h ?? 0)) * 100}%`,
                    }}
                  >
                    {e.from}→{e.to}
                  </span>
                ))}
            </div>
          ) : (
            <div className="flex aspect-square h-full max-w-full items-center justify-center rounded-lg border-2 border-black bg-white">
              <span className="text-sm text-neutral-400">press Capture</span>
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

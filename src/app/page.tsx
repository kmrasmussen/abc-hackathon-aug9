"use client";

import { useEffect, useRef, useState } from "react";
import Mermaid from "./Mermaid";

/** A detected shape, in normalized 0–1 coordinates. */
type Shape = { label: string; x: number; y: number; w: number; h: number };

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

  const posOf = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = ctxOf();
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = posOf(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = ctxOf();
    if (!ctx) return;
    const p = posOf(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const stop = () => {
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

  const onShowToLlm = async () => {
    if (!capture) return;
    setAsking(true);
    setAnswer(null);
    setMermaid(null);
    try {
      const res = await fetch("/api/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: capture }),
      });
      const data = await res.json();
      setAnswer(res.ok ? data.text : `error: ${data.error ?? res.status}`);
      if (res.ok) setMermaid(data.mermaid ?? null);
    } catch (err) {
      setAnswer(`error: ${String(err)}`);
    } finally {
      setAsking(false);
    }
  };

  const label = "text-xs uppercase tracking-widest text-neutral-500";

  return (
    <main className="grid h-screen grid-cols-2 gap-4 overflow-hidden bg-white p-4 text-black">
      {/* left — the drawing surface, a square as large as the column allows */}
      <section className="flex min-h-0 flex-col gap-2">
        <h2 className={label}>Draw</h2>
        <div className="flex min-h-0 flex-1 items-start justify-center">
          <div
            ref={wrapRef}
            className="aspect-square h-full max-w-full overflow-hidden rounded-lg border-2 border-black"
            style={{ maxHeight: "100%" }}
          >
            <canvas
              ref={canvasRef}
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={stop}
              onPointerLeave={stop}
              onPointerCancel={stop}
              className="block h-full w-full cursor-crosshair touch-none bg-white"
            />
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
          <button
            onClick={onShowToLlm}
            disabled={!capture || asking}
            className="rounded-md bg-black px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {asking ? "Looking…" : "Show picture to LLM"}
          </button>
          <button
            onClick={onDetect}
            disabled={!capture || detecting}
            className="rounded-md border-2 border-black px-3 py-1.5 text-sm font-medium text-black transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {detecting ? "Detecting…" : "Detect shapes"}
          </button>
        </div>

        <h2 className={`${label} shrink-0`}>
          Captured
          {shapes && (
            <span className="ml-2 normal-case tracking-normal text-neutral-400">
              {shapes.length} shape{shapes.length === 1 ? "" : "s"}
            </span>
          )}
        </h2>
        <div className="flex min-h-0 flex-1 items-start justify-center">
          {capture ? (
            <div className="relative aspect-square h-full max-w-full overflow-hidden rounded-lg border-2 border-black bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={capture} alt="captured drawing" className="block h-full w-full object-contain" />
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

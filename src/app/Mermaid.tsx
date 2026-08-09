"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Renders Mermaid source to SVG, reporting syntax errors rather than throwing.
 *
 * `highlight` names a node or edge label to light up. It is applied by walking
 * the already-rendered SVG rather than re-rendering, so pointing at something
 * updates instantly without the diagram flickering.
 */
export default function Mermaid({
  code,
  highlight,
}: {
  code: string;
  highlight?: string | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(0);
  const reactId = useId();

  useEffect(() => {
    let cancelled = false;
    const id = `m${reactId.replace(/[^a-zA-Z0-9]/g, "")}`;

    (async () => {
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({
        startOnLoad: false,
        theme: "neutral",
        securityLevel: "strict",
        flowchart: { htmlLabels: false },
      });

      try {
        const { svg } = await mermaid.render(id, code);
        if (cancelled) return;
        setError(null);
        if (hostRef.current) hostRef.current.innerHTML = svg;
        setReady((n) => n + 1);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        if (hostRef.current) hostRef.current.innerHTML = "";
      }
      // mermaid leaves its failed-render probe node behind
      document.getElementById(`d${id}`)?.remove();
    })();

    return () => {
      cancelled = true;
    };
  }, [code, reactId]);

  /** Toggle the highlight class on whichever node's text matches. */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    host.querySelectorAll(".is-listening").forEach((el) => el.classList.remove("is-listening"));
    if (!highlight) return;

    // Edge labels arrive as "From -> To"; light up both ends.
    const wanted = highlight.includes("->")
      ? highlight.split("->").map((t) => t.trim().toLowerCase())
      : [highlight.trim().toLowerCase()];

    for (const node of Array.from(host.querySelectorAll("g.node"))) {
      const text = (node.textContent ?? "").trim().toLowerCase();
      if (text && wanted.includes(text)) node.classList.add("is-listening");
    }

    // For an edge, also light the path between the two nodes.
    if (highlight.includes("->")) {
      for (const path of Array.from(host.querySelectorAll("path.flowchart-link"))) {
        path.classList.add("is-listening");
      }
    }
  }, [highlight, ready]);

  return (
    <div className="flex h-full w-full flex-col">
      <style>{`
        .mermaid-host g.node.is-listening rect,
        .mermaid-host g.node.is-listening circle,
        .mermaid-host g.node.is-listening polygon,
        .mermaid-host g.node.is-listening ellipse {
          fill: #ede9fe !important;
          stroke: #7c3aed !important;
          stroke-width: 3px !important;
        }
        .mermaid-host g.node.is-listening {
          transform-box: fill-box;
          transform-origin: center;
          animation: listening 1.2s ease-in-out infinite;
        }
        .mermaid-host path.flowchart-link.is-listening {
          stroke: #7c3aed !important;
          stroke-width: 3px !important;
        }
        @keyframes listening {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.06); }
        }
      `}</style>
      <div ref={hostRef} className="mermaid-host flex-1 [&>svg]:h-full [&>svg]:w-full" />
      {error && (
        <pre className="mt-2 shrink-0 overflow-auto rounded border border-rose-300 bg-rose-50 p-2 text-xs text-rose-700">
          {error}
        </pre>
      )}
    </div>
  );
}

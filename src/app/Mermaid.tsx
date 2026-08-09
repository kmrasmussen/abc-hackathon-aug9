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

    host
      .querySelectorAll(".is-listening, .is-listening-marker")
      .forEach((el) => el.classList.remove("is-listening", "is-listening-marker"));
    if (!highlight) return;

    const markLink = (path: Element) => {
      path.classList.add("is-listening");
      // The head is a separate <marker> referenced by url(#id) — colour it too.
      const ref = path.getAttribute("marker-end") ?? "";
      const markerId = ref.match(/url\(#(.+?)\)/)?.[1];
      if (markerId) host.querySelector(`#${CSS.escape(markerId)}`)?.classList.add("is-listening-marker");
    };

    if (highlight.includes("->")) {
      // Only the one link, not its endpoints and not every other edge. Mermaid
      // ids links as "<prefix>L_<from>_<to>_<n>" using the node ids, so find
      // the ids whose labels match the two ends of this edge.
      const [fromLabel, toLabel] = highlight.split("->").map((t) => t.trim().toLowerCase());
      const idOf = (label: string) => {
        for (const node of Array.from(host.querySelectorAll("g.node"))) {
          if ((node.textContent ?? "").trim().toLowerCase() === label) {
            // Node ids look like "mr0-flowchart-A-0"; the mermaid id is the
            // part after "flowchart-", before the trailing index.
            return node.id.match(/flowchart-(.+)-\d+$/)?.[1] ?? null;
          }
        }
        return null;
      };
      const a = idOf(fromLabel);
      const b = idOf(toLabel);

      for (const path of Array.from(host.querySelectorAll("path.flowchart-link"))) {
        const m = path.id.match(/L_(.+?)_(.+?)_\d+$/);
        if (a && b && m) {
          if (m[1] === a && m[2] === b) markLink(path);
        } else if (!a || !b) {
          // Couldn't resolve ids — better to light nothing than the wrong edge.
          continue;
        }
      }
      return;
    }

    // A plain node label lights just that node.
    const wanted = highlight.trim().toLowerCase();
    for (const node of Array.from(host.querySelectorAll("g.node"))) {
      const text = (node.textContent ?? "").trim().toLowerCase();
      if (text && text === wanted) node.classList.add("is-listening");
    }
  }, [highlight, ready]);

  return (
    <div className="flex h-full w-full flex-col">
      <style>{`
        /* Colour only — no transforms. Scaling an SVG group re-anchors its
           coordinate system and shifts the whole diagram out of place. */
        .mermaid-host g.node rect,
        .mermaid-host g.node circle,
        .mermaid-host g.node polygon,
        .mermaid-host g.node ellipse,
        .mermaid-host path.flowchart-link {
          transition: fill 180ms ease, stroke 180ms ease;
        }
        .mermaid-host g.node.is-listening rect,
        .mermaid-host g.node.is-listening circle,
        .mermaid-host g.node.is-listening polygon,
        .mermaid-host g.node.is-listening ellipse {
          fill: #ddd6fe !important;
          stroke: #7c3aed !important;
        }
        .mermaid-host g.node.is-listening text,
        .mermaid-host g.node.is-listening tspan {
          fill: #5b21b6 !important;
          font-weight: 700 !important;
        }
        /* Mermaid styles links via its own classes, so match them explicitly.
           Arrowheads are separate marker paths and need colouring too. */
        .mermaid-host svg path.flowchart-link.is-listening,
        .mermaid-host svg .edgePaths path.is-listening,
        .mermaid-host svg path.is-listening {
          stroke: #7c3aed !important;
          stroke-width: 3px !important;
          opacity: 1 !important;
        }
        .mermaid-host svg marker.is-listening path,
        .mermaid-host svg marker.is-listening,
        .mermaid-host svg .is-listening-marker path {
          fill: #7c3aed !important;
          stroke: #7c3aed !important;
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

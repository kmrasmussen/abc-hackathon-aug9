"use client";

import { useEffect, useId, useRef, useState } from "react";

/** Renders Mermaid source to SVG, reporting syntax errors rather than throwing. */
export default function Mermaid({ code }: { code: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
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

  return (
    <div className="flex h-full w-full flex-col">
      <div ref={hostRef} className="mermaid-host flex-1 [&>svg]:h-full [&>svg]:w-full" />
      {error && (
        <pre className="mt-2 shrink-0 overflow-auto rounded border border-rose-300 bg-rose-50 p-2 text-xs text-rose-700">
          {error}
        </pre>
      )}
    </div>
  );
}

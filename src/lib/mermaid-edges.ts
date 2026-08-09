/** An edge parsed out of Mermaid source. */
export type MermaidEdge = { from: string; to: string };

/**
 * Pull `A --> B` style edges out of Mermaid flowchart source.
 * Strips bracketed labels first so `A[Frontend] --> B[Middleend]` reduces to A --> B.
 * Handles -->, ---, -.->, ==>, and edge labels (`-- text -->`, `-->|text|`).
 */
export function parseMermaidEdges(code: string): MermaidEdge[] {
  const edges: MermaidEdge[] = [];
  const seen = new Set<string>();

  for (const rawLine of code.split("\n")) {
    // Drop node labels so only ids and connectors remain.
    const line = rawLine
      .replace(/\[\[.*?\]\]|\(\(.*?\)\)|\(\[.*?\]\)|\[.*?\]|\{.*?\}|\(.*?\)/g, "")
      .replace(/\|[^|]*\|/g, "") // edge labels written as -->|text|
      // labels written inline as `-- text -->` collapse to a plain connector
      .replace(/\s-{2,}\s[^->]*?\s-{2,}>/g, " --> ")
      .trim();
    if (!line || /^(flowchart|graph|subgraph|end|classDef|class|style)\b/i.test(line)) continue;

    // Split on any arrow-ish connector, keeping the chain (A --> B --> C).
    const parts = line.split(/\s*(?:-{2,}>|-{3,}|-\.->|-\.-|={2,}>|={3,})\s*/);
    if (parts.length < 2) continue;

    for (let i = 0; i < parts.length - 1; i++) {
      const from = parts[i].trim().split(/\s+/).pop() ?? "";
      const to = parts[i + 1].trim().split(/\s+/)[0] ?? "";
      if (!/^[A-Za-z][\w-]*$/.test(from) || !/^[A-Za-z][\w-]*$/.test(to)) continue;
      const key = `${from}->${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from, to });
    }
  }

  return edges;
}

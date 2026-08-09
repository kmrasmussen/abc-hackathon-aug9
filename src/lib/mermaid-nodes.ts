/** A node parsed out of Mermaid source. */
export type MermaidNode = { id: string; label: string };

/**
 * Pull `id[label]` style declarations out of Mermaid flowchart source.
 * Handles the common shape brackets: [], (), (()), {}, [[]], ([]).
 * Node ids are whatever the model emitted, so callers should key off `label`.
 */
export function parseMermaidNodes(code: string): MermaidNode[] {
  const found = new Map<string, string>();

  // id followed by a bracketed label — the bracket style picks the shape.
  const re = /\b([A-Za-z][\w-]*)\s*(\[\[|\(\(|\(\[|\[|\(|\{)([^\]\)\}]*?)(\]\]|\)\)|\]\)|\]|\)|\})/g;

  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const id = m[1];
    const label = m[3].trim().replace(/^["']|["']$/g, "");
    if (!label) continue;
    // First declaration wins; later references are usually bare ids.
    if (!found.has(id)) found.set(id, label);
  }

  return [...found.entries()].map(([id, label]) => ({ id, label }));
}

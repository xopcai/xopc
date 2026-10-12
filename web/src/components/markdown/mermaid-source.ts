const MERMAID_SOURCE_HEADER_RE = /^(?:(?:flowchart|graph)\s+(?:TD|TB|LR|BT|RL)\b|stateDiagram(?:-v2)?\b|sequenceDiagram\b|classDiagram\b|erDiagram\b|xychart(?:-beta)?\b)/i;

/** Recognize unlabeled Mermaid fences without interpreting other named languages. */
export function isMermaidSource(code: string): boolean {
  const firstLine = code.trimStart().split(/[\r\n;]/, 1)[0]?.trim() ?? '';
  return MERMAID_SOURCE_HEADER_RE.test(firstLine);
}

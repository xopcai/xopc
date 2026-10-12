import { describe, expect, it } from 'vitest';

import { isMermaidSource } from '../mermaid-source';

describe('unlabeled Mermaid source', () => {
  it.each(['flowchart LR\nA-->B', 'graph TD; A-->B', 'sequenceDiagram\nA->>B: Hello', 'stateDiagram-v2\nA-->B'])('recognizes supported diagram headers: %s', source => {
    expect(isMermaidSource(source)).toBe(true);
  });
  it.each(['const ready = true;', 'graphical output', '# Heading'])('keeps ordinary fences as code: %s', source => {
    expect(isMermaidSource(source)).toBe(false);
  });
});

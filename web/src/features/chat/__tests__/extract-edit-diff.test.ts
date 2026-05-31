import { describe, expect, it } from 'vitest';

import { extractEditDiff } from '@/features/chat/tool-results/extract-edit-diff';
import { parseToolResult } from '@/features/chat/tool-results/parse-tool-result';

const sampleDiff =
  '--- a/src/foo.ts\n' +
  '+++ b/src/foo.ts\n' +
  '@@ -1,4 +1,5 @@\n' +
  ' const x = 1;\n' +
  '-const y = 2;\n' +
  '+const y = 22;\n' +
  '+const z = 3;\n' +
  ' export { x, y };\n';

describe('extractEditDiff', () => {
  it('returns null when no diff present', () => {
    const parsed = parseToolResult({
      content: [{ type: 'text', text: 'File edited' }],
      details: {},
    });
    expect(extractEditDiff(parsed)).toBeNull();
  });

  it('returns null when result is plain text (history path)', () => {
    expect(extractEditDiff(parseToolResult('File edited: /tmp/foo.ts'))).toBeNull();
  });

  it('parses unified diff with correct +/- counts (excluding file-header markers)', () => {
    const parsed = parseToolResult({
      content: [{ type: 'text', text: 'File edited' }],
      details: { diff: sampleDiff },
    });
    const diff = extractEditDiff(parsed);
    expect(diff).not.toBeNull();
    expect(diff!.added).toBe(2);
    expect(diff!.removed).toBe(1);
  });

  it('classifies each line by kind', () => {
    const parsed = parseToolResult({
      content: [],
      details: { diff: sampleDiff },
    });
    const kinds = extractEditDiff(parsed)!.lines.map((l) => l.kind);
    expect(kinds).toEqual([
      'meta', // --- a/...
      'meta', // +++ b/...
      'hunk', // @@ -1,4 +1,5 @@
      'context', // ' const x = 1;'
      'del', // -const y = 2;
      'add', // +const y = 22;
      'add', // +const z = 3;
      'context', // ' export { x, y };'
      'context', // trailing empty line after split
    ]);
  });
});

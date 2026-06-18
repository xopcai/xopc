import { describe, expect, it } from 'vitest';

import {
  isDiffFriendlyTool,
  looksLikeUnifiedDiff,
  renderUnifiedDiff,
} from '../tui-tool-diff.js';

function stripAnsi(text: string): string {
  return text
    .replace(/][^]*/g, '')
    .replace(/[[0-9;]*m/g, '');
}

describe('tui-tool-diff', () => {
  it('detects unified diff output', () => {
    const diff = '@@ -1,2 +1,2 @@\n-old\n+new';
    expect(looksLikeUnifiedDiff(diff)).toBe(true);
    expect(isDiffFriendlyTool('edit')).toBe(true);
    expect(stripAnsi(renderUnifiedDiff(diff))).toContain('+new');
  });

  it('highlights changed spans inside single-line replacements', () => {
    const rendered = renderUnifiedDiff('@@ -1 +1 @@\n-const name = "old";\n+const name = "new";');

    expect(stripAnsi(rendered)).toContain('-const name = "old";');
    expect(stripAnsi(rendered)).toContain('+const name = "new";');
    expect(rendered).toContain('\x1b[7mold\x1b[27m');
    expect(rendered).toContain('\x1b[7mnew\x1b[27m');
  });

  it('keeps headers out of replacement-pair highlighting', () => {
    const rendered = renderUnifiedDiff('--- a/file.ts\n+++ b/file.ts\n-old\n+new');

    expect(stripAnsi(rendered)).toContain('--- a/file.ts');
    expect(stripAnsi(rendered)).toContain('+++ b/file.ts');
    expect(rendered).toContain('\x1b[7mold\x1b[27m');
  });
});

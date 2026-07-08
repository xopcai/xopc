import { describe, expect, it } from 'vitest';

import {
  isDiffFriendlyTool,
  looksLikeUnifiedDiff,
  parseUnifiedPatch,
  renderPatchSummary,
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

  it('renders line-numbered hunks', () => {
    const rendered = stripAnsi(renderUnifiedDiff('@@ -9,2 +9,2 @@\n unchanged\n-old\n+new'));

    expect(rendered).toContain(' 9  unchanged');
    expect(rendered).toContain('10 -old');
    expect(rendered).toContain('10 +new');
  });

  it('parses and summarizes added files', () => {
    const diff = [
      '--- /dev/null',
      '+++ b/src/agent/session/__tests__/session-inspector.test.ts',
      '@@ -0,0 +1,3 @@',
      '+import { describe, expect, it } from "vitest";',
      '+',
      '+describe("SessionInspector", () => {});',
    ].join('\n');

    const parsed = parseUnifiedPatch(diff);
    expect(parsed?.files[0]).toMatchObject({
      kind: 'add',
      path: 'src/agent/session/__tests__/session-inspector.test.ts',
      added: 3,
      removed: 0,
    });

    const rendered = stripAnsi(renderPatchSummary(diff) ?? '');
    expect(rendered).toContain(
      'Added src/agent/session/__tests__/session-inspector.test.ts (+3 -0)',
    );
    expect(rendered).toContain('1 +import');
  });

  it('summarizes multi-file patches', () => {
    const diff = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/b.ts b/b.ts',
      '--- a/b.ts',
      '+++ b/b.ts',
      '@@ -1 +1,2 @@',
      ' same',
      '+next',
    ].join('\n');

    const rendered = stripAnsi(renderPatchSummary(diff) ?? '');
    expect(rendered).toContain('Edited 2 files (+2 -1)');
    expect(rendered).toContain('Edited a.ts (+1 -1)');
    expect(rendered).toContain('Edited b.ts (+1 -0)');
  });

  it('keeps git diff metadata out of line numbering', () => {
    const diff = [
      'diff --git a/file.ts b/file.ts',
      'index 1111111..2222222 100644',
      '--- a/file.ts',
      '+++ b/file.ts',
      '@@ -20 +20 @@',
      '-old',
      '+new',
    ].join('\n');

    const rendered = stripAnsi(renderUnifiedDiff(diff));
    expect(rendered).toContain('index 1111111..2222222 100644');
    expect(rendered).toContain('20 -old');
    expect(rendered).toContain('20 +new');
    expect(rendered).not.toContain(' 0  index');
  });
});

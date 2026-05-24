import { describe, expect, it } from 'vitest';

import { computeContextUsagePercent, formatContextUsageLabel } from '../tui-context-usage.js';
import {
  isDiffFriendlyTool,
  looksLikeUnifiedDiff,
  renderUnifiedDiff,
} from '../tui-tool-diff.js';
import { DEFAULT_TUI_SETTINGS } from '../tui-settings.js';

describe('tui-tool-diff', () => {
  it('detects unified diff output', () => {
    const diff = '@@ -1,2 +1,2 @@\n-old\n+new';
    expect(looksLikeUnifiedDiff(diff)).toBe(true);
    expect(isDiffFriendlyTool('edit')).toBe(true);
    expect(renderUnifiedDiff(diff)).toContain('+new');
  });
});

describe('tui-context-usage', () => {
  it('formats context percent', () => {
    expect(computeContextUsagePercent(50_000, 100_000)).toBe(50);
    expect(formatContextUsageLabel(50)).toBe('50% ctx');
  });
});

describe('tui settings phase3', () => {
  it('includes startup hints default', () => {
    expect(DEFAULT_TUI_SETTINGS.showStartupHints).toBe(true);
  });
});

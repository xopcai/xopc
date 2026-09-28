import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workspace = readFileSync(new URL('../entry/src/main/ets/view/WorkspaceView.ets', import.meta.url), 'utf8');

describe('workspace mobile information architecture', () => {
  it('offers section-aware filtering and count context before the item list', () => {
    expect(workspace).toContain("this.filterChip('all'");
    expect(workspace).toContain("this.filterChip('primary'");
    expect(workspace).toContain("this.filterChip('secondary'");
    expect(workspace).toContain("$r('app.string.workspace_item_count'");
  });

  it('uses dedicated cards with status, summaries, and type-specific metadata', () => {
    expect(workspace).toContain('workspaceCard(item: XopcWorkspaceItem)');
    expect(workspace).toContain('this.itemSummary(item)');
    expect(workspace).toContain('item.projectId');
    expect(workspace).toContain('item.priority');
    expect(workspace).toContain('this.automationTiming(item)');
  });

  it('keeps detail hierarchy separate from editing and exposes automation timing', () => {
    expect(workspace).toContain("$r('app.string.workspace_description')");
    expect(workspace).toContain("$r('app.string.workspace_details')");
    expect(workspace).toContain("$r('app.string.workspace_next_run')");
    expect(workspace).toContain("$r('app.string.workspace_last_run')");
  });
});

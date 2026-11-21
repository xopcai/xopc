import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workspace = readFileSync(new URL('../entry/src/main/ets/view/WorkspaceView.ets', import.meta.url), 'utf8');
const files = readFileSync(new URL('../entry/src/main/ets/view/FilesView.ets', import.meta.url), 'utf8');
const notes = readFileSync(new URL('../entry/src/main/ets/view/NotesView.ets', import.meta.url), 'utf8');

describe('workspace list loading layout', () => {
  it('keeps search controls above the initial loading skeleton', () => {
    expect(workspace.indexOf("placeholder: $r('app.string.search')")).toBeLessThan(
      workspace.indexOf('if (this.model.busy && !this.model.items.length)'),
    );
  });

  it('keeps file search above navigable rows without adding a loading row', () => {
    const listStart = files.indexOf('List({ space: 0 })');
    expect(listStart).toBeGreaterThan(files.indexOf("placeholder: $r('app.string.search')"));
    expect(files.slice(listStart)).not.toContain('XopcListSkeleton');
  });

  it('uses list loading placeholders instead of a text refresh control', () => {
    const workspaceList = workspace.slice(workspace.indexOf('  list() {'), workspace.indexOf('  automationDetail('));
    expect(workspaceList).not.toContain("Button($r('app.string.refresh'))");
    expect(workspaceList).toContain('ListItem() { XopcListSkeleton() }');
  });

  it('renders file spaces as navigable rows instead of emphasized pill buttons', () => {
    expect(files).not.toContain('Button(space.title)');
    expect(files).toContain("XopcHubRow({ heading: space.title, symbol: $r('sys.symbol.folder')");
    expect(files).toContain('compact: true,');
  });

  it('keeps note content primary and moves secondary actions into a sheet', () => {
    expect(notes).toContain('List({ space: 0, scroller: this.detailScroller })');
    expect(notes).toContain(".id('note-more')");
    expect(notes).toContain('.bindSheet($$this.sheetOpen, this.activeSheetContent');
    expect(notes).not.toContain("Button($r('app.string.note_manage_tags')).width('100%')");
  });
});

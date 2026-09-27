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
    expect(files.indexOf("placeholder: $r('app.string.search')")).toBeLessThan(
      files.indexOf('if (this.model.busy && !this.model.items.length)'),
    );
  });

  it('uses icon-only refresh controls with accessible labels', () => {
    for (const source of [workspace, files]) {
      expect(source).not.toContain("Button($r('app.string.refresh'))");
      expect(source).toContain("SymbolGlyph($r('sys.symbol.arrow_clockwise'))");
      expect(source).toContain(".accessibilityText($r('app.string.refresh'))");
    }
  });

  it('renders file spaces as navigable rows instead of emphasized pill buttons', () => {
    expect(files).not.toContain('Button(space.title)');
    expect(files).toContain("XopcHubRow({ heading: space.title, symbol: $r('sys.symbol.folder')");
    expect(files).toContain('.backgroundColor(this.colors.input).borderRadius(14)');
  });

  it('keeps note content primary and moves secondary actions into a sheet', () => {
    expect(notes).toContain('List({ space: 0 })');
    expect(notes).toContain("this.detailAction($r('app.string.more')");
    expect(notes).toContain('.bindSheet($$this.moreOpen, this.moreSheet');
    expect(notes).not.toContain("Button($r('app.string.note_manage_tags')).width('100%')");
  });
});

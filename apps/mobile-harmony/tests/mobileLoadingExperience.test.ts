import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('mobile destination loading experience', () => {
  it('restores chat history before draft reconciliation or network recovery', () => {
    const source = read('../entry/src/main/ets/viewmodel/chatViewModel.ets');
    const open = source.slice(source.indexOf('async open(id: string)'), source.indexOf('private async restoreCachedHistory'));
    expect(open.indexOf('void this.restoreCachedHistory(id, selection)')).toBeGreaterThan(-1);
    expect(open.indexOf('void this.restoreCachedHistory(id, selection)')).toBeLessThan(open.indexOf('await this.repository.reconcile(id)'));
    expect(open.indexOf('void this.restoreCachedHistory(id, selection)')).toBeLessThan(open.indexOf('await this.recover(true)'));
  });

  it('uses one branded loading component for immediate detail destinations', () => {
    const components = read('../entry/src/main/ets/view/MobileComponents.ets');
    expect(components).toContain('export struct XopcBrandLoading');
    expect(components).toContain("app.media.brand_logo_base");
    expect(components).toContain("app.media.brand_logo_accent");
    for (const file of ['NotesView.ets', 'WorkspaceView.ets', 'AboutYouView.ets', 'FilesView.ets', 'WorkflowView.ets']) {
      expect(read(`../entry/src/main/ets/view/${file}`)).toContain('XopcBrandLoading');
    }
  });

  it('enters note and workspace detail state before awaiting the response', () => {
    const notes = read('../entry/src/main/ets/viewmodel/noteViewModel.ets');
    const workspace = read('../entry/src/main/ets/viewmodel/workspaceViewModel.ets');
    expect(notes.indexOf('this.openingId = id')).toBeLessThan(notes.indexOf('await this.repository.detail(id)'));
    expect(workspace.indexOf('this.openingId = id')).toBeLessThan(workspace.indexOf('await this.repository.detail(this.section, id)'));
  });
});

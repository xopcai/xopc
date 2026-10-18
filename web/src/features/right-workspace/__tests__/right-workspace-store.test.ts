// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { useGatewayStore } from '@/stores/gateway-store';
import { useRightWorkspaceStore as workspace } from '@/stores/right-workspace-store';

beforeEach(() => { workspace.getState().reset(); workspace.getState().setScope('parent'); });

describe('right workspace transitions', () => {
  it('mixes files and side chats, deduplicates files, and returns to the source on close', () => {
    const s = workspace.getState();
    s.addSideChat('s1', 'Analysis', 'parent');
    const id = s.openFile({ path: 'report.md', conversationId: 'parent' });
    const second = s.openFile({ path: './report.md', conversationId: 'parent', line: 8 });
    expect(id).toBe(second);
    expect(workspace.getState().panes.parent.tabs.map((t) => t.kind)).toEqual(['sidechat', 'file']);
    expect(workspace.getState().panes.parent.tabs[1]).toMatchObject({ line: 8, returnTo: 'side:s1' });
    s.remove(id);
    expect(workspace.getState().panes.parent.activeId).toBe('side:s1');
    s.remove('side:s1');
    expect(workspace.getState().panes.parent).toEqual({ open: true, tabs: [], activeId: null });
  });

  it('isolates same-named files by root and each parent conversation', () => {
    const s = workspace.getState();
    const a = s.openFile({ path: 'report.md', projectId: 'a' });
    const b = s.openFile({ path: 'report.md', projectId: 'b' });
    s.setScope('other');
    s.openFile({ path: 'report.md', projectId: 'a' });
    expect(a).not.toBe(b);
    expect(workspace.getState().panes.parent.tabs).toHaveLength(2);
    expect(workspace.getState().panes.other.tabs).toHaveLength(1);
  });

  it('merges resolved aliases without losing the active file or opening it again', () => {
    const s = workspace.getState();
    const a = s.openFile({ path: 'report.md', conversationId: 'parent' });
    s.resolveFileIdentity(a, 'resource');
    const b = s.openFile({ path: '/project/report.md', conversationId: 'parent', line: 9 });
    s.resolveFileIdentity(b, 'resource');
    expect(workspace.getState().panes.parent.tabs).toHaveLength(1);
    expect(workspace.getState().panes.parent.activeId).toBe(a);
    expect(s.openFile({ path: '/project/report.md', conversationId: 'parent' })).toBe(a);
  });

  it('never merges away an edited file', () => {
    const s = workspace.getState();
    const a = s.openFile({ path: 'report.md' });
    s.resolveFileIdentity(a, 'resource');
    const b = s.openFile({ path: '/project/report.md' });
    s.setFileStatus(b, 'dirty');
    s.resolveFileIdentity(b, 'resource');
    expect(workspace.getState().panes.parent.tabs).toHaveLength(2);
  });

  it('collapses without removing tabs and never selects a late background side chat', () => {
    const s = workspace.getState();
    const file = s.openFile({ path: 'report.md' });
    s.setOpen(false);
    s.addSideChat('background', 'Analysis', 'parent', false);
    expect(workspace.getState().panes.parent).toMatchObject({ open: false, activeId: file });
    s.setOpen(true);
    expect(workspace.getState().panes.parent.tabs).toHaveLength(2);
  });

  it('closing a background tab preserves the active tab and replaces a recreated side chat in place', () => {
    const s = workspace.getState();
    s.addSideChat('old', 'Analysis', 'parent');
    const file = s.openFile({ path: 'report.md' });
    s.replaceSideChat('old', 'new', 'parent');
    expect(workspace.getState().panes.parent.tabs[0]).toMatchObject({ id: 'side:new', sideChatId: 'new' });
    s.remove('side:new');
    expect(workspace.getState().panes.parent.activeId).toBe(file);
  });

  it('keeps anonymous local attachments distinct and excludes their payloads from storage', () => {
    const s = workspace.getState();
    const attachment = { name: 'same.txt', content: 'private payload' };
    const a = s.openFile({ attachment });
    expect(s.openFile({ attachment })).toBe(a);
    expect(s.openFile({ attachment: { ...attachment } })).not.toBe(a);
    const saved = sessionStorage.getItem('xopc:right-workspace:v1');
    expect(saved).not.toContain('private payload');
  });

  it('clears files and unsaved metadata when switching gateways', () => {
    const s = workspace.getState();
    const file = s.openFile({ path: 'report.md' });
    s.setFileStatus(file, 'dirty');
    useGatewayStore.setState({ baseUrl: 'http://workspace-test.invalid' });
    expect(workspace.getState().panes).toEqual({});
    expect(workspace.getState().fileStatus).toEqual({});
  });
  it('turns a tool start tab into files or a new side chat without adding nested tabs', () => {
    const s = workspace.getState();
    const home = s.openTools();
    s.openFiles();
    expect(workspace.getState().panes.parent.tabs).toHaveLength(1);
    expect(workspace.getState().panes.parent.tabs[0]).toMatchObject({ id: home, kind: 'files' });
    s.openTools();
    s.addSideChat('new', 'Side chat', 'parent');
    expect(workspace.getState().panes.parent.tabs.map((t) => t.kind)).toEqual(['files', 'sidechat']);
  });

  it('moves a new-chat workspace only through the explicit conversation handoff', () => {
    const s = workspace.getState();
    s.setScope('new');
    const file = s.openFile({ attachment: { name: 'draft.txt', content: 'unsent' } });
    s.migrateScope('new', 'created');
    expect(workspace.getState().panes.new).toBeUndefined();
    expect(workspace.getState().panes.created.activeId).toBe(file);
    expect(workspace.getState().scope).toBe('created');
  });

});

it('replaces home with a browser, allows duplicate URLs, and preserves sidechat/file tabs', () => {
  const s = workspace.getState();
  const file = s.openFile({ path: 'report.md' });
  s.addSideChat('s1', 'Side chat', 'parent');
  const home = s.openTools();
  expect(s.openBrowser('https://example.com/?x=1#hash')).toBe(home);
  const second = s.openBrowser('https://example.com/?x=1#hash');
  expect(second).not.toBe(home);
  expect(workspace.getState().panes.parent.tabs.map(t => t.kind)).toEqual(['file', 'sidechat', 'browser', 'browser']);
  s.updateBrowserTitle(home, 'Updated page');
  expect(workspace.getState().panes.parent.activeId).toBe(second);
  s.remove(second);
  expect(workspace.getState().panes.parent.activeId).toBe(home);
  expect(workspace.getState().panes.parent.tabs.some(t => t.id === file)).toBe(true);
});

it('does not persist browser URLs, titles or native identities in session storage', () => {
  const s = workspace.getState();
  s.openBrowser('https://example.com/callback?code=private');
  s.updateBrowserTitle(workspace.getState().panes.parent.activeId!, 'Private document');
  const saved = sessionStorage.getItem('xopc:right-workspace:v1')!;
  expect(saved).not.toContain('private');
  expect(saved).not.toContain('Private document');
  expect(JSON.parse(saved).panes.parent.tabs).toEqual([]);
});

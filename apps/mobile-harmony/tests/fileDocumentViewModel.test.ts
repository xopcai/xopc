import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined });
  return { request: vi.fn() };
});
vi.mock('../entry/src/main/ets/service/gatewaySession.ets', () => ({ gatewaySession: { request: mocks.request } }));
import { managedFileMedia, XopcFileDocumentViewModel } from '../entry/src/main/ets/viewmodel/fileDocumentViewModel.ets';
const resource = { id: 'f/a', spaceId: 's', name: 'page.html', relativePath: 'page.html', parentPath: '',
  kind: 'file', mimeType: 'text/html', size: 20, modifiedAt: 1, revision: 'r1', capabilities: ['preview', 'edit', 'download'] };
const response = (file = resource) => JSON.stringify({ resource: file });

describe('shared file document editing', () => {
  beforeEach(() => { mocks.request.mockReset(); });
  it('opens in preview mode and only fetches complete source on explicit edit', async () => {
    const model = new XopcFileDocumentViewModel(); mocks.request.mockResolvedValueOnce(response());
    await model.inspect(managedFileMedia(resource), '');
    expect(model.canEdit()).toBe(true); expect(model.editing).toBe(false);
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith('/api/files/f%2Fa', 'GET', '');
    const full = 'x'.repeat(110000); mocks.request.mockResolvedValueOnce(full);
    await model.beginEdit(); expect(model.content).toBe(full); expect(model.dirty()).toBe(false);
    model.content += 'saved'; mocks.request.mockResolvedValueOnce(response({ ...resource, revision: 'r2' }));
    expect(await model.save()).toBe(true);
    expect(JSON.parse(mocks.request.mock.calls.at(-1)![2])).toEqual({ content: full + 'saved', revision: 'r1' });
    expect(model.resource?.revision).toBe('r2'); expect(model.editing).toBe(false);
  });
  it('retains unsaved edits on a revision conflict', async () => {
    const model = new XopcFileDocumentViewModel(); model.resource = resource;
    mocks.request.mockResolvedValueOnce('old'); await model.beginEdit(); model.content = 'new';
    mocks.request.mockRejectedValueOnce(new Error('REVISION_CONFLICT'));
    expect(await model.save()).toBe(false); expect(model.dirty()).toBe(true);
    expect(model.content).toBe('new'); expect(model.error).toBe('REVISION_CONFLICT');
    model.cancelEdit(); expect(model.content).toBe('old'); expect(model.editing).toBe(false);
  });
  it('never edits unsupported, oversized or read-only resources', () => {
    const model = new XopcFileDocumentViewModel();
    for (const file of [{ ...resource, capabilities: ['preview'] }, { ...resource, size: 1048577 },
      { ...resource, name: 'report.pdf', mimeType: 'application/pdf' }]) {
      model.resource = file; expect(model.canEdit()).toBe(false);
    }
  });
  it('ignores a late editor response after closing or switching files', async () => {
    const model = new XopcFileDocumentViewModel(); model.resource = resource;
    let finish!: (text: string) => void;
    mocks.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = model.beginEdit(); model.reset(); finish('stale'); await pending;
    expect(model.editing).toBe(false); expect(model.content).toBe(''); expect(model.resource).toBeUndefined();
  });
  it('resolves workspace paths in the originating conversation and never resolves external links', async () => {
    const model = new XopcFileDocumentViewModel();
    mocks.request.mockResolvedValueOnce(JSON.stringify({ space: { id: 'space' } })).mockResolvedValueOnce(response());
    await model.inspect({ ...managedFileMedia(resource), uri: '', workspaceRelativePath: 'out/page.html' }, 'chat/id');
    expect(mocks.request.mock.calls[0][0]).toBe('/api/files/contexts/session/chat%2Fid');
    expect(JSON.parse(mocks.request.mock.calls[1][2])).toEqual({ spaceId: 'space', path: 'out/page.html' });
    mocks.request.mockClear(); await model.inspect({ ...managedFileMedia(resource), uri: 'https://example.org/page.html' }, '');
    expect(mocks.request).not.toHaveBeenCalled(); expect(model.canEdit()).toBe(false);
  });
  it('routes library files through the same preview and editor as chat attachments', () => {
    const view = readFileSync(new URL('../entry/src/main/ets/view/FilesView.ets', import.meta.url), 'utf8');
    const media = readFileSync(new URL('../entry/src/main/ets/view/ChatMediaView.ets', import.meta.url), 'utf8');
    expect(view).toContain('XopcChatMediaView({ file: managedFileMedia(file)');
    expect(view).not.toContain('TextArea('); expect(view).not.toContain('private canPreview(');
    expect(media).toContain(".id('file-preview-editor')");
    expect(media).toContain('onWillDismiss: (action: DismissSheetAction)');
    expect(media).toContain('this.document.dirty()');
  });
});

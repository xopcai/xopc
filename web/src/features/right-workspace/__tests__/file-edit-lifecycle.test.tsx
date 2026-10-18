// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspacePreviewState } from '@/features/preview-runtime/use-workspace-preview-state';
import { readWorkspaceFile, writeWorkspaceFile } from '@/features/workspace/workspace-api';

vi.mock('@/features/workspace/workspace-api', () => ({
  readWorkspaceFile: vi.fn(async () => ({ content: 'original', mtimeMs: 1, revision: 'v1' })),
  writeWorkspaceFile: vi.fn(async () => ({ mtimeMs: 2, revision: 'v2' })),
  resolveWorkspaceFileReference: vi.fn(async () => ({ fileId: 'resource', mtimeMs: 1 })),
  resolveWorkspaceFileResource: vi.fn(),
  fetchWorkspaceFileBlob: vi.fn(),
  downloadBinaryFile: vi.fn(), downloadTextFile: vi.fn(),
}));

let state: ReturnType<typeof useWorkspacePreviewState>;
function Harness() { state = useWorkspacePreviewState({ filePath: 'report.md', conversationId: 'parent' }); return null; }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; }

describe('file editing across workspace tabs', () => {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(<Harness />));
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });

  it('flushes an edit before its debounce and submits the loaded revision', async () => {
    act(() => state.onSourceChange('last keystroke'));
    expect(state.dirty).toBe(true);
    await act(async () => expect(await state.flushSource()).toBe(true));
    expect(writeWorkspaceFile).toHaveBeenCalledWith('report.md', 'last keystroke', { conversationId: 'parent' }, 'v1');
    expect(state.dirty).toBe(false);
    expect(state.saveStatus).toBe('saved');
  });

  it('serializes writes and saves edits made during an in-flight request using the new revision', async () => {
    const first = deferred<Awaited<ReturnType<typeof writeWorkspaceFile>>>();
    vi.mocked(writeWorkspaceFile).mockReturnValueOnce(first.promise);
    act(() => state.onSourceChange('first edit'));
    let saving!: Promise<boolean>;
    act(() => { saving = state.flushSource(); });
    act(() => state.onSourceChange('second edit'));
    expect(writeWorkspaceFile).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve({ path: 'report.md', revision: 'v2', mtimeMs: 2 }); await saving; });
    expect(writeWorkspaceFile).toHaveBeenNthCalledWith(2, 'report.md', 'second edit', { conversationId: 'parent' }, 'v2');
    expect(state.textContent).toBe('second edit');
    expect(state.dirty).toBe(false);
  });

  it('retains failed/conflicting edits, blocks close, and protects page unload', async () => {
    vi.mocked(writeWorkspaceFile).mockRejectedValueOnce(new Error('File has changed'));
    act(() => state.onSourceChange('unsaved draft'));
    await act(async () => expect(await state.flushSource()).toBe(false));
    expect(state.saveStatus).toBe('error');
    expect(state.textContent).toBe('unsaved draft');
    expect(state.dirty).toBe(true);
    const leave = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);
    act(() => state.refresh());
    expect(readWorkspaceFile).toHaveBeenCalledTimes(1);
  });
});

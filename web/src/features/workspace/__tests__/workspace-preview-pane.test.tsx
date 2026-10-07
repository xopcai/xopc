// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspacePreviewPane } from '../workspace-preview-pane';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';

vi.mock('../workspace-file-preview-dialog', () => ({
  WorkspaceFilePreviewPanel: ({ filePath }: { filePath: string }) => <div>{filePath}</div>,
}));

let container: HTMLDivElement | null = null;
let unmount: (() => void) | null = null;

afterEach(() => {
  if (unmount) act(unmount);
  container?.remove();
  container = null;
  unmount = null;
  useWorkspacePreviewStore.getState().setPath(null);
});

describe('WorkspacePreviewPane', () => {
  it('keeps a chat file preview open from the Personal AI route', () => {
    useWorkspacePreviewStore.getState().setPath('ai-news-brief-2026-10-07.md');
    container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    unmount = () => root.unmount();

    act(() => root.render(<MemoryRouter initialEntries={['/personal']}>
      <WorkspacePreviewPane allowOutsideChat />
    </MemoryRouter>));

    expect(useWorkspacePreviewStore.getState().path).toBe('ai-news-brief-2026-10-07.md');
    expect(container.textContent).toContain('ai-news-brief-2026-10-07.md');
  });
});

// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';

import { MarkdownView } from '../markdown-view';

it('loads local images through the authenticated loader and releases their blob URLs', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const createUrl = vi.fn(() => 'blob:local-image');
  const revokeUrl = vi.fn();
  const load = vi.fn(async () => new Blob(['image'], { type: 'image/png' }));
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = createUrl;
  URL.revokeObjectURL = revokeUrl;
  try {
    await act(async () => {
      root.render(<MemoryRouter><MarkdownView content="![Report](file:///tmp/report.png)" onWorkspaceFileOpen={() => {}} onWorkspaceImageLoad={load} /></MemoryRouter>);
    });
    expect(load).toHaveBeenCalledWith({ path: '/tmp/report.png', kind: 'absolute', line: undefined });
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:local-image');
    act(() => root.unmount());
    expect(revokeUrl).toHaveBeenCalledWith('blob:local-image');
  } finally {
    container.remove();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

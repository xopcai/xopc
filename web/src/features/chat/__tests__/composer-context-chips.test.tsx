// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComposerContextChips } from '@/features/chat/composer/composer-context-chips';

describe('ComposerContextChips', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('uses a folder icon for a selected directory', () => {
    act(() => {
      root.render(
        <ComposerContextChips
          refs={[{
            kind: 'file', sourceId: 'folder-1', expectedVersion: '7', title: 'mobile-expo',
            fileKind: 'directory',
          }]}
          label="References"
          onRemove={vi.fn()}
        />,
      );
    });

    expect(container.querySelector('.lucide-folder')).not.toBeNull();
    expect(container.querySelector('.lucide-file-text')).toBeNull();
    expect(container.textContent).toContain('mobile-expo');
  });
});

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileTree } from '@/features/file-tree/file-tree';

const labels = {
  preview: 'Preview',
  download: 'Download',
  copyPath: 'Copy path',
  openDefault: 'Open with default app',
  openDirectory: 'Open in file manager',
  openWith: 'Choose app',
  recommendedApps: 'Recommended',
  desktopUpdateRequired: 'Update desktop app',
};

const tree = [
  { fileId: 'space.folder', name: 'folder', path: 'folder', isDirectory: true, children: [] },
  { fileId: 'space.file', name: 'report.md', path: 'report.md', isDirectory: false },
];

describe('FileTree managed desktop actions', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(window, 'electronAPI');
  });

  function renderTree(onAction = vi.fn()) {
    act(() => {
      root.render(
        <FileTree
          tree={tree}
          selectedPath={null}
          onSelectFile={() => {}}
          onAction={onAction}
          actionLabels={labels}
          emptyHint="Empty"
        />,
      );
    });
    return onAction;
  }

  it('offers the system file manager for managed directories', () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { shell: { openFileResource: vi.fn(), chooseAppAndOpenFileResource: vi.fn() } },
    });
    const onAction = renderTree();

    act(() => container.querySelectorAll<HTMLButtonElement>('[aria-label="More"]')[0].click());
    const openButton = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((button) => button.textContent === labels.openDirectory);
    expect(openButton).toBeDefined();

    act(() => openButton!.click());
    expect(onAction).toHaveBeenCalledWith('openDefault', tree[0], undefined);
  });

  it('keeps the default-app action for managed files', () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { shell: { openFileResource: vi.fn(), chooseAppAndOpenFileResource: vi.fn() } },
    });
    renderTree();

    act(() => container.querySelectorAll<HTMLButtonElement>('[aria-label="More"]')[1].click());
    expect(Array.from(container.querySelectorAll('[role="menuitem"]')).some(
      (item) => item.textContent === labels.openDefault,
    )).toBe(true);
  });

  it('explains an outdated Electron bridge instead of silently hiding local actions', () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { shell: {} },
    });
    renderTree();

    act(() => container.querySelectorAll<HTMLButtonElement>('[aria-label="More"]')[1].click());
    const updateItem = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((button) => button.textContent === labels.desktopUpdateRequired);
    expect(updateItem?.disabled).toBe(true);
  });
});

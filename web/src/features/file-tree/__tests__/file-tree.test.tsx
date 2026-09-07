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
  delete: 'Delete permanently',
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

  it('offers permanent deletion for files but not directories', () => {
    const onAction = renderTree();

    act(() => container.querySelectorAll<HTMLButtonElement>('[aria-label="More"]')[0].click());
    expect(Array.from(container.querySelectorAll('[role="menuitem"]')).some(
      (item) => item.textContent === labels.delete,
    )).toBe(false);
    act(() => document.body.querySelector<HTMLButtonElement>('.fixed.inset-0')?.click());

    act(() => container.querySelectorAll<HTMLButtonElement>('[aria-label="More"]')[1].click());
    const deleteButton = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((button) => button.textContent === labels.delete);
    act(() => deleteButton!.click());
    expect(onAction).toHaveBeenCalledWith('delete', tree[1], undefined);
  });

  it('uploads external drops to the root or the targeted subfolder', () => {
    const onUploadFiles = vi.fn();
    act(() => {
      root.render(
        <FileTree
          tree={tree}
          selectedPath={null}
          onSelectFile={() => {}}
          onUploadFiles={onUploadFiles}
          uploadDropHint="Drop to upload"
          emptyHint="Empty"
        />,
      );
    });
    const file = new File(['report'], 'report.txt', { type: 'text/plain' });
    const drop = (element: Element) => {
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', {
        value: { types: ['Files'], files: [file], dropEffect: 'none' },
      });
      act(() => element.dispatchEvent(event));
    };

    drop(container.querySelector('[data-file-drop-directory="folder"]')!);
    expect(onUploadFiles).toHaveBeenLastCalledWith([file], 'folder');

    drop(container.querySelector('[data-file-drop-directory=""]')!);
    expect(onUploadFiles).toHaveBeenLastCalledWith([file], '');
  });
});

// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig, type Cache } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchProjects } from '@/features/projects/api';
import { ComposerContextBar, type ComposerContextBarProps } from '../composer-context-bar';

const { refreshContext } = vi.hoisted(() => ({ refreshContext: vi.fn() }));
vi.mock('@/features/chat/context/use-session-context', () => ({
  useSessionContext: () => ({ data: { environment: { kind: 'local_checkout', rootPath: '/tmp/workspace', branch: 'feature/context', available: true } }, mutate: refreshContext }),
}));
vi.mock('@/features/projects/api', () => ({ fetchProjects: vi.fn() }));

describe('ComposerContextBar', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let cache: Cache;
  const openDirectory = vi.fn();
  const onProjectChange = vi.fn();
  const onWorkspaceChange = vi.fn();
  const render = async (props: Partial<ComposerContextBarProps> = {}) => act(async () => root.render(
    <SWRConfig value={{ provider: () => cache }}>
      <ComposerContextBar sessionKey="s1" canChangeWorkspace disabled={false} onProjectChange={onProjectChange} onWorkspaceChange={onWorkspaceChange} {...props} />
    </SWRConfig>,
  ));

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    cache = new Map();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { file: { openDirectory } } });
    openDirectory.mockResolvedValue('/tmp/chosen');
    onWorkspaceChange.mockResolvedValue(undefined);
    vi.mocked(fetchProjects).mockResolvedValue({ ok: true, items: [{ id: 'p2', name: 'Another project' }] as never[], total: 1 });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(window, 'electronAPI');
  });

  it('lets a projectless new chat choose a project and a folder from the composer', async () => {
    await render();
    expect(container.textContent).toContain('Choose project');
    expect(container.textContent).toContain('feature/context');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Change the project for this chat"]')!.click());
    const option = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Another project')!;
    await act(async () => option.click());
    expect(onProjectChange).toHaveBeenCalledWith('p2');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Choose folder"]')!.click());
    expect(openDirectory).toHaveBeenCalledWith({ defaultPath: '/tmp/workspace' });
    expect(onWorkspaceChange).toHaveBeenCalledWith('/tmp/chosen');
    expect(refreshContext).toHaveBeenCalledTimes(1);
  });

  it('removes the project, respects project folder locks, and disables actions while busy', async () => {
    const props = { project: { id: 'p1', name: 'xopc' }, canChangeWorkspace: false };
    await render(props);
    const remove = container.querySelector<HTMLButtonElement>('[aria-label="Remove project from new chat"]')!;
    expect(container.querySelector('[aria-label="Choose folder"]')).toBeNull();
    await act(async () => remove.click());
    expect(onProjectChange).toHaveBeenCalledWith(null);
    await render({ ...props, disabled: true });
    expect(remove.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Change the project for this chat"]')!.disabled).toBe(true);
  });

  it('keeps the original folder and exposes a failed save', async () => {
    onWorkspaceChange.mockRejectedValue(new Error('Directory unavailable'));
    await render();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Choose folder"]')!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Directory unavailable');
    expect(container.querySelector('[aria-label="Choose folder"]')?.textContent).toBe('workspace');
    expect(refreshContext).not.toHaveBeenCalled();
  });
});

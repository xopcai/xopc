// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { useWorkspaceTree } from '../use-workspace-tree';
import { fetchWorkspaceDirectoryListing, fetchWorkspaceRootResource, listWorkspaceDir } from '../workspace-api';

vi.mock('../workspace-api', () => ({
  fetchWorkspaceDirectoryListing: vi.fn().mockResolvedValue({ entries: [] }),
  fetchWorkspaceRootResource: vi.fn().mockResolvedValue({ id: 'root', name: 'Project', path: '', isDirectory: true }),
  listWorkspaceDir: vi.fn().mockResolvedValue([]),
}));

it('browses the project before first send and the session workspace after creation', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  const root = createRoot(container);
  let tree!: ReturnType<typeof useWorkspaceTree>;
  function Harness({ sessionKey }: { sessionKey?: string }) {
    tree = useWorkspaceTree('main', sessionKey, sessionKey ? null : 'project-1');
    return null;
  }
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => { await tree.loadRoot(); await tree.loadChildren('src'); });
    expect(fetchWorkspaceDirectoryListing).toHaveBeenLastCalledWith('', { projectId: 'project-1' });
    expect(fetchWorkspaceRootResource).toHaveBeenLastCalledWith({ projectId: 'project-1' });
    expect(listWorkspaceDir).toHaveBeenLastCalledWith('src', { projectId: 'project-1' });
    await act(async () => root.render(<Harness sessionKey="session-1" />));
    await act(async () => { await tree.loadRoot(); await tree.loadChildren('src'); });
    expect(fetchWorkspaceDirectoryListing).toHaveBeenLastCalledWith('', { sessionKey: 'session-1' });
    expect(listWorkspaceDir).toHaveBeenLastCalledWith('src', { sessionKey: 'session-1' });
  } finally {
    await act(async () => root.unmount());
  }
});

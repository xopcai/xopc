// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchProject } from '@/features/projects/api';
import { openNewChatHandoff } from '@/features/chat/session/new-chat-handoff';
import type { SessionManager } from '@/features/chat/session/session-manager';
import { useChatSessionInit, type ProjectSessionPreparation } from '@/features/chat/session/use-chat-session-init';

vi.mock('@/features/projects/api', () => ({ fetchProject: vi.fn() }));
vi.mock('@/features/chat/session/new-chat-handoff', () => ({ openNewChatHandoff: vi.fn() }));

describe('project session preparation', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let preparation: ProjectSessionPreparation | null;
  const project = { id: 'project-a', name: 'Code project', workspaceRoot: '/repo', executionMode: 'managed_worktree' } as Awaited<ReturnType<typeof fetchProject>>;
  const runtime = {
    sessionMgrRef: { current: { loadSessionAgentConfig: vi.fn(async () => ({ model: 'test/model' })) } as unknown as SessionManager },
    resolveAgentIdForPost: () => 'main', navigateToSession: vi.fn(), loadSessionById: vi.fn(async () => []),
    tryResumeAgentRun: vi.fn(async () => {}), restoreLiveCacheIfNeeded: () => false,
    adoptEmptySession: vi.fn(), applyAgentConfig: vi.fn(), patchInitUi: vi.fn(),
  };
  function Harness({ locationKey = 'one', search = '?projectId=project-a&draft=hello&autoSend=1', token = 'token', existing = false, temporary = false, requestedAgentId = undefined as string | undefined }) {
    preparation = useChatSessionInit({
      ...runtime, token, temporary, requestedAgentId, isNewRoute: !existing, forceNewChat: false, decodedKey: existing ? 'existing' : undefined,
      locationKey, locationSearch: search,
    });
    return null;
  }
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(fetchProject).mockResolvedValue(project);
    vi.mocked(openNewChatHandoff).mockImplementation(async (opts) => {
      opts.onOpened('created');
      opts.navigateToSession('created', true, opts.search);
      return 'created';
    });
    container = document.createElement('div');
    root = createRoot(container);
    preparation = null;
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it('waits for an explicit mode without allocating or reusing a session', async () => {
    await act(async () => root.render(<Harness />));
    expect(preparation?.project).toEqual(project);
    expect(openNewChatHandoff).not.toHaveBeenCalled();
    expect(runtime.navigateToSession).not.toHaveBeenCalled();
    await act(async () => preparation!.create('local_checkout'));
    expect(openNewChatHandoff).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-a', executionMode: 'local_checkout', search: '?draft=hello&autoSend=1' }));
    expect(runtime.adoptEmptySession).toHaveBeenCalledWith('created', null);
    expect(runtime.navigateToSession).toHaveBeenCalledWith('created', true, '?draft=hello&autoSend=1');
  });

  it('preserves the preparation and composer handoff after a failed create', async () => {
    vi.mocked(openNewChatHandoff).mockRejectedValueOnce(new Error('Worktree unavailable'));
    await act(async () => root.render(<Harness />));
    const original = preparation;
    await act(async () => { await expect(preparation!.create('managed_worktree')).rejects.toThrow('Worktree unavailable'); });
    expect(preparation).toBe(original);
    expect(runtime.adoptEmptySession).not.toHaveBeenCalled();
    expect(runtime.navigateToSession).not.toHaveBeenCalled();
    await act(async () => preparation!.create('managed_worktree'));
    expect(openNewChatHandoff).toHaveBeenCalledTimes(2);
  });

  it('does not prepare or change an existing conversation environment', async () => {
    await act(async () => root.render(<Harness existing />));
    expect(preparation).toBeNull();
    expect(fetchProject).not.toHaveBeenCalled();
    expect(openNewChatHandoff).not.toHaveBeenCalled();
  });

  it.each([undefined, 'reviewer'])('preserves temporary mode and resolves the requested agent %s before confirmation', async (requestedAgentId) => {
    vi.mocked(fetchProject).mockResolvedValue({ ...project, defaultAgentId: 'coder' });
    await act(async () => root.render(<Harness temporary requestedAgentId={requestedAgentId} />));
    expect(preparation?.agentId).toBe(requestedAgentId ?? 'coder');
    expect(preparation?.temporary).toBe(true);
    await act(async () => preparation!.create('managed_worktree'));
    expect(openNewChatHandoff).toHaveBeenCalledWith(expect.objectContaining({ agentId: requestedAgentId ?? 'coder', temporary: true, executionMode: 'managed_worktree' }));
  });

  it('uses a newly selected agent instead of the project default on first send', async () => {
    vi.mocked(fetchProject).mockResolvedValue({ ...project, defaultAgentId: 'coder' });
    await act(async () => root.render(<Harness />));
    expect(preparation?.agentId).toBe('coder');
    expect(openNewChatHandoff).not.toHaveBeenCalled();
    await act(async () => root.render(<Harness locationKey="changed-agent" requestedAgentId="reviewer" />));
    expect(preparation?.agentId).toBe('reviewer');
    expect(preparation?.project.id).toBe('project-a');
    expect(openNewChatHandoff).not.toHaveBeenCalled();
    await act(async () => preparation!.create('local_checkout'));
    expect(openNewChatHandoff).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'reviewer', projectId: 'project-a', executionMode: 'local_checkout',
    }));
  });

  it('keeps non-workspace projects on the existing creation flow', async () => {
    vi.mocked(fetchProject).mockResolvedValue({ ...project, workspaceRoot: undefined });
    await act(async () => root.render(<Harness />));
    expect(preparation).toBeNull();
    expect(openNewChatHandoff).toHaveBeenCalledOnce();
    expect(vi.mocked(openNewChatHandoff).mock.calls[0]?.[0].executionMode).toBeUndefined();
  });

  it('ignores a stale project fetch after navigating away', async () => {
    let finish!: (value: typeof project) => void;
    vi.mocked(fetchProject).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await act(async () => root.render(<Harness />));
    await act(async () => root.render(<Harness locationKey="two" existing />));
    await act(async () => finish(project));
    expect(preparation).toBeNull();
    expect(openNewChatHandoff).not.toHaveBeenCalled();
  });

  it('rejects a stale confirmation after changing credentials', async () => {
    await act(async () => root.render(<Harness />));
    const stale = preparation!;
    await act(async () => root.render(<Harness token="another-token" />));
    await expect(stale.create('managed_worktree')).rejects.toThrow('request changed');
    expect(openNewChatHandoff).not.toHaveBeenCalled();
  });

  it('does not navigate back when provisioning finishes after navigation away', async () => {
    let finish!: () => void;
    vi.mocked(openNewChatHandoff).mockImplementation(async (opts) => {
      await new Promise<void>((resolve) => { finish = resolve; });
      opts.onOpened('created');
      opts.navigateToSession('created');
      return 'created';
    });
    await act(async () => root.render(<Harness />));
    const pending = preparation!.create('managed_worktree');
    await act(async () => root.render(<Harness locationKey="two" existing />));
    await act(async () => { finish(); await pending; });
    expect(runtime.adoptEmptySession).not.toHaveBeenCalled();
    expect(runtime.navigateToSession).not.toHaveBeenCalled();
  });
});

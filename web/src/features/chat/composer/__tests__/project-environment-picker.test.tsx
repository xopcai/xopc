// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig, type Cache } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Project } from '@/features/projects/api';
import type { ProjectSessionPreparation } from '@/features/chat/session/use-chat-session-init';
import { fetchJson } from '@/lib/fetch';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import { ProjectEnvironmentPicker } from '../project-environment-picker';
import { useProjectSessionComposer, type ProjectSessionComposer } from '../use-project-session-composer';
import { commitAcceptedSend } from '../commit-accepted-send';

vi.mock('@/lib/fetch', () => ({ fetchJson: vi.fn() }));

describe('composer project environment selection and first send', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let selection: ProjectSessionComposer;
  let cache: Cache;
  const create = vi.fn<ProjectSessionPreparation['create']>();
  const onSend = vi.fn();
  const commit = vi.fn();
  const preparation = {
    project: { id: 'code', name: 'Code', workspaceRoot: '/repo', executionMode: 'managed_worktree' } as Project,
    create, agentId: 'main', temporary: false,
  };
  const attachments = [{ type: 'file', name: 'draft.txt', data: 'keep' }];
  const refs = [{ kind: 'note' as const, sourceId: 'draft', title: 'Draft note', expectedVersion: 'v1' }];
  type Props = { prepared?: ProjectSessionPreparation | null; sessionKey?: string | null; ready?: boolean; sender?: typeof onSend };
  function Harness({ prepared = preparation, sessionKey = null, ready = false, sender = onSend }: Props) {
    selection = useProjectSessionComposer({ preparation: prepared, sessionKey, ready, onSend: sender });
    return <>
      {prepared ? <ProjectEnvironmentPicker selection={selection} /> : null}
      <button disabled={selection.busy} onClick={() => commitAcceptedSend(selection.send('Keep draft', attachments, 'off', refs), commit)}>Send</button>
    </>;
  }
  const render = async (props: Props = {}) => act(async () => root.render(
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}><Harness {...props} /></SWRConfig>,
  ));
  const submit = () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Send')!;
  const select = () => container.querySelector<HTMLButtonElement>('button[aria-label="New session environment"]')!;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    create.mockReset().mockResolvedValue('created');
    onSend.mockReset();
    commit.mockReset();
    vi.mocked(fetchJson).mockReset().mockResolvedValue({ options: { localAvailable: true } });
    useGatewayStore.setState({ token: undefined });
    useLocaleStore.setState({ language: 'en' });
    cache = new Map();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

  it('shows only two icon choices without a creation button or eager allocation', async () => {
    await render();
    expect(select().textContent).toBe('New local worktree');
    expect(select().querySelector('svg')).not.toBeNull();
    expect(container.textContent).not.toContain('Create session');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => select().click());
    const options = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];
    expect(options.map((option) => option.textContent)).toEqual(['Local', 'New local worktree']);
    expect(options.every((option) => option.querySelectorAll('svg').length === 2)).toBe(true);
    await act(async () => options[0].click());
    expect(select().textContent).toBe('Local');
    expect(create).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('creates once on first send and waits for the new session before consuming the whole draft', async () => {
    let finish!: (key: string) => void;
    create.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await render();
    await act(async () => { submit().click(); submit().click(); });
    expect(create).toHaveBeenCalledExactlyOnceWith('managed_worktree');
    expect(submit().disabled).toBe(true);
    expect(select().disabled).toBe(true);
    expect(commit).not.toHaveBeenCalled();
    await act(async () => finish('created'));
    const currentSender = vi.fn();
    await render({ prepared: null, sessionKey: 'created', sender: currentSender });
    expect(currentSender).not.toHaveBeenCalled();
    await render({ prepared: null, sessionKey: 'created', ready: true, sender: currentSender });
    expect(currentSender).toHaveBeenCalledExactlyOnceWith('Keep draft', attachments, undefined, refs);
    expect(onSend).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledOnce();
  });

  it('preserves the selected mode and draft after failure; retries without a Local fallback', async () => {
    create.mockRejectedValueOnce(new Error('Worktree creation failed'));
    await render();
    await act(async () => submit().click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Worktree creation failed');
    expect(select().textContent).toBe('New local worktree');
    expect(commit).not.toHaveBeenCalled();
    expect(submit().disabled).toBe(false);
    await act(async () => submit().click());
    await render({ prepared: null, sessionKey: 'created', ready: true });
    expect(create.mock.calls).toEqual([['managed_worktree'], ['managed_worktree']]);
    expect(onSend).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
  });

  it('blocks unavailable Worktree and allows an explicit Local first send', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ options: { localAvailable: true, worktreeUnavailableReason: 'git_commit_required' } });
    await render();
    await act(async () => submit().click());
    expect(create).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(container.textContent).toContain('at least one commit');
    await act(async () => select().click());
    const options = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];
    expect(options[1]?.disabled).toBe(true);
    await act(async () => options[0].click());
    await act(async () => submit().click());
    expect(create).toHaveBeenCalledExactlyOnceWith('local_checkout');
  });

  it('waits for preflight and allows retrying a failed check without consuming the draft', async () => {
    let fail!: (error: Error) => void;
    vi.mocked(fetchJson).mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
    await render();
    expect(select()).toBeNull();
    await act(async () => submit().click());
    expect(create).not.toHaveBeenCalled();
    await act(async () => fail(new Error('Unavailable')));
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Could not check');
    expect(select().disabled).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Recheck environment"]')!.click());
    expect(select().disabled).toBe(false);
    expect(selection.allowed).toBe(true);
    expect(commit).not.toHaveBeenCalled();
  });

  it('does not send or clear a different draft when creation finishes after navigation away', async () => {
    let finish!: (key: string) => void;
    create.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await render();
    await act(async () => submit().click());
    await render({ prepared: null, sessionKey: 'another', ready: true });
    await act(async () => finish('created'));
    expect(onSend).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('cancels pending sends when gateway credentials change', async () => {
    await render();
    await act(async () => submit().click());
    await act(async () => useGatewayStore.setState({ token: 'different-gateway' }));
    await render({ prepared: null, sessionKey: 'created', ready: true });
    expect(onSend).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('restores each new preparation default rather than leaking another project choice', async () => {
    await render();
    await act(async () => selection.changeMode('local_checkout'));
    expect(select().textContent).toBe('Local');
    await render({ prepared: { ...preparation, project: { ...preparation.project, id: 'another' } } });
    expect(select().textContent).toBe('New local worktree');
    expect(create).not.toHaveBeenCalled();
  });

  it('leaves an existing session submission and explicit thinking level unchanged', async () => {
    await render({ prepared: null, sessionKey: 'existing', ready: true });
    await act(async () => submit().click());
    expect(create).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledExactlyOnceWith('Keep draft', attachments, 'off', refs);
    expect(commit).toHaveBeenCalledOnce();
  });
});

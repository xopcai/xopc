// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig, type Cache } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectSessionPreparation } from '@/features/chat/session/use-chat-session-init';
import type { Project } from '@/features/projects/api';
import { fetchJson } from '@/lib/fetch';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import { ProjectDirectoryStatus } from '../project-directory-status';
import { useProjectSessionComposer, type ProjectSessionComposer } from '../use-project-session-composer';
import { commitAcceptedSend } from '../commit-accepted-send';
import { __resetComposerInputHistoryForTests, getComposerInputHistory, recordComposerInputHistory } from '../composer-input-history';

vi.mock('@/lib/fetch', () => ({ fetchJson: vi.fn() }));

describe('composer project directory and first send', () => {
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
  type Props = { prepared?: ProjectSessionPreparation | null; conversationId?: string | null; ready?: boolean; sender?: typeof onSend };
  function Harness({ prepared = preparation, conversationId = null, ready = false, sender = onSend }: Props) {
    selection = useProjectSessionComposer({ preparation: prepared, conversationId, ready, onSend: sender });
    return <>
      {prepared ? <ProjectDirectoryStatus composer={selection} /> : null}
      <button disabled={selection.busy} onClick={() => void selection.prepareSession()}>Terminal</button>
      <button disabled={selection.busy} onClick={() => commitAcceptedSend(selection.send('Keep draft', attachments, 'off', refs), commit)}>Send</button>
    </>;
  }
  const render = async (props: Props = {}) => act(async () => root.render(
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}><Harness {...props} /></SWRConfig>,
  ));
  const submit = () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Send')!;
  const openTerminal = () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Terminal')!;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    create.mockReset().mockResolvedValue('created');
    onSend.mockReset();
    commit.mockReset();
    __resetComposerInputHistoryForTests();
    vi.mocked(fetchJson).mockReset().mockResolvedValue({ options: { localAvailable: true } });
    localStorage.clear();
    useGatewayStore.setState({ conversationId: undefined });
    useLocaleStore.setState({ language: 'en' });
    cache = new Map();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

  it('checks only the project directory and waits for first send to create a session', async () => {
    await render();
    expect(fetchJson).toHaveBeenCalledWith(expect.stringContaining('/environment-options?mode=local_checkout'));
    expect(container.textContent).toBe('TerminalSend');
    expect(create).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('waits for server acceptance and retains a rejected draft in an existing session', async () => {
    let accept!: (value: boolean) => void;
    onSend.mockImplementation(() => new Promise<boolean>(resolve => { accept = resolve; }));
    await render({ prepared: null, conversationId: 'existing', ready: true });
    await act(async () => submit().click());
    expect(commit).not.toHaveBeenCalled();
    await act(async () => accept(false));
    expect(commit).not.toHaveBeenCalled();
    await act(async () => submit().click());
    await act(async () => accept(true));
    expect(commit).toHaveBeenCalledOnce();
  });

  it('creates once on first send and waits for the new session before consuming the whole draft', async () => {
    let finish!: (key: string) => void;
    create.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await render();
    await act(async () => { submit().click(); submit().click(); });
    expect(create).toHaveBeenCalledExactlyOnceWith('local_checkout', undefined, expect.any(Function));
    expect(submit().disabled).toBe(true);
    expect(commit).not.toHaveBeenCalled();
    act(() => create.mock.calls[0][2]!('created'));
    expect(selection.getDraftHandoffTarget()).toBe('created');
    const currentSender = vi.fn();
    await render({ prepared: null, conversationId: 'created', sender: currentSender });
    expect(currentSender).not.toHaveBeenCalled();
    await act(async () => finish('created'));
    await render({ prepared: null, conversationId: 'created', ready: true, sender: currentSender });
    expect(currentSender).toHaveBeenCalledExactlyOnceWith('Keep draft', attachments, undefined, refs);
    expect(onSend).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledOnce();
  });

  it('records the first message under the created session, including after navigating away during acceptance', async () => {
    let accept!: (value: boolean) => void;
    const createdSender = vi.fn(() => new Promise<boolean>(resolve => { accept = resolve; }));
    commit.mockImplementation((id: string) => recordComposerInputHistory(id, 'Keep draft'));
    await render();
    await act(async () => submit().click());
    await render({ prepared: null, conversationId: 'created', ready: true, sender: createdSender });
    expect(createdSender).toHaveBeenCalledOnce();
    await render({ prepared: null, conversationId: 'other', ready: true });
    await act(async () => accept(true));
    expect(commit).toHaveBeenCalledExactlyOnceWith('created');
    expect(getComposerInputHistory('created')).toEqual(['Keep draft']);
    expect(getComposerInputHistory('other')).toEqual([]);
    expect(getComposerInputHistory('new')).toEqual([]);
  });

  it('keeps an existing session submission attached to its original session after switching', async () => {
    let accept!: (value: boolean) => void;
    onSend.mockImplementation(() => new Promise<boolean>(resolve => { accept = resolve; }));
    await render({ prepared: null, conversationId: 'existing', ready: true });
    await act(async () => submit().click());
    await render({ prepared: null, conversationId: 'other', ready: true });
    await act(async () => accept(true));
    expect(commit).toHaveBeenCalledExactlyOnceWith('existing');
  });

  it('prepares the project directory from the terminal action without sending a draft', async () => {
    let finish!: (key: string) => void;
    create.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await render();
    await act(async () => openTerminal().click());
    expect(create).toHaveBeenCalledExactlyOnceWith('local_checkout', undefined, expect.any(Function));
    expect(openTerminal().disabled).toBe(true);
    expect(onSend).not.toHaveBeenCalled();

    await act(async () => finish('created'));
    await render({ prepared: null, conversationId: 'created', ready: true });
    expect(onSend).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('keeps the draft after a local preparation failure so it can be sent again', async () => {
    create.mockRejectedValueOnce(new Error('Directory unavailable'));
    await render();
    await act(async () => submit().click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Directory unavailable');
    expect(commit).not.toHaveBeenCalled();
    await act(async () => submit().click());
    await render({ prepared: null, conversationId: 'created', ready: true });
    expect(create.mock.calls.map(([mode]) => mode)).toEqual(['local_checkout', 'local_checkout']);
    expect(onSend).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
  });

  it('sends from a dirty project directory despite a remembered Worktree choice', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ options: { localAvailable: true, worktreeUnavailableReason: 'uncommitted_changes' } });
    localStorage.setItem('xopc.webchat.newSessionPreferences', JSON.stringify({
      version: 1, executionModeByProject: { code: 'managed_worktree' },
    }));
    await render();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(selection.allowed).toBe(true);
    await act(async () => submit().click());
    expect(create).toHaveBeenCalledExactlyOnceWith('local_checkout', undefined, expect.any(Function));
  });

  it('shows an unavailable project directory without consuming the draft', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ options: { localAvailable: false } });
    await render();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Project directory unavailable');
    expect(selection.allowed).toBe(false);
    await act(async () => submit().click());
    expect(create).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('waits for preflight and allows retrying a failed check without consuming the draft', async () => {
    let fail!: (error: Error) => void;
    vi.mocked(fetchJson).mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
    await render();
    await act(async () => submit().click());
    expect(create).not.toHaveBeenCalled();
    await act(async () => fail(new Error('Unavailable')));
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Could not check');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Recheck project directory"]')!.click());
    expect(selection.allowed).toBe(true);
    expect(commit).not.toHaveBeenCalled();
  });

  it('does not send or clear a different draft when creation finishes after navigation away', async () => {
    let finish!: (key: string) => void;
    create.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await render();
    await act(async () => submit().click());
    await render({ prepared: null, conversationId: 'another', ready: true });
    await act(async () => finish('created'));
    expect(onSend).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('cancels pending sends when gateway credentials change', async () => {
    await render();
    await act(async () => submit().click());
    await act(async () => useGatewayStore.setState({ conversationId: 'different-gateway' }));
    await render({ prepared: null, conversationId: 'created', ready: true });
    expect(onSend).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('leaves an existing session submission and explicit thinking level unchanged', async () => {
    await render({ prepared: null, conversationId: 'existing', ready: true });
    await act(async () => submit().click());
    expect(create).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledExactlyOnceWith('Keep draft', attachments, 'off', refs);
    expect(commit).toHaveBeenCalledOnce();
  });
});

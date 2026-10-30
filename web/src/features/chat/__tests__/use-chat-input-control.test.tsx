// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatFollowUpClarify } from '../session/use-chat-follow-up-clarify';
import { rememberInputControl } from '../session/session-input-control';
import { useGatewayStore } from '@/stores/gateway-store';
import { useChatSessionStore } from '../session/chat-session-store';
import { showComposerNotification } from '../composer/composer-notifications';
import { apiFetch } from '@/lib/fetch';

vi.mock('../composer/composer-notifications', () => ({ showComposerNotification: vi.fn() }));
vi.mock('@/lib/fetch', () => ({ apiFetch: vi.fn() }));
vi.mock('../session/local-session-drafts', () => ({ readLocalSessionDraft: async () => undefined, readSessionTranscript: async () => 'transcript' }));

const id = 'control-editor-test';
let state: { activeRunId?: string; conversationId: string; revision: number; control: { version: number; paused: boolean; phase: 'idle' | 'running' | 'stopping'; reviewRequired: boolean }; inputs: unknown[] };
let hook: ReturnType<typeof useChatFollowUpClarify>;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let failSave = false;
const options = { conversationId: id, decodedKey: id, conversationIdRef: { current: id }, sendingRef: { current: false },
  streamingRef: { current: false }, modelSupportsThinking: false, thinkingLevel: 'off', shouldApplyStreamUpdate: () => true };
function Harness() { hook = useChatFollowUpClarify(options); return null; }
beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useGatewayStore.setState({ conversationId: 'input-control-gateway' });
  state = { activeRunId: 'active', conversationId: id, revision: 0, control: { version: 0, paused: false, phase: 'idle', reviewRequired: false },
    inputs: [{ id: 'followup', clientMessageId: 'f', content: 'Follow-up', status: 'queued', effectiveDelivery: 'next', version: 1 }] };
  options.conversationId = id; options.decodedKey = id; options.conversationIdRef.current = id;
  rememberInputControl(id, state.control); failSave = false;
  vi.mocked(apiFetch).mockImplementation(async (url, init) => {
    if (String(url).endsWith('/clarification')) return Response.json({ payload: null });
    if (String(url).endsWith('/input-control')) {
      const command = JSON.parse(String(init?.body));
      state = { ...state, revision: state.revision + 1, control: { ...state.control, paused: command.action !== 'resume', version: state.control.version + 1 } };
    }
    if (init?.method === 'PATCH') return Response.json({ payload: state, error: failSave ? { message: 'Input changed' } : undefined }, { status: failSave ? 409 : 200 });
    return Response.json({ payload: state });
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

describe('unified input editing', () => {
  it('keeps turn and follow-up editing mutually exclusive', async () => {
    await act(async () => { expect(await hook.beginEditTurn('turn')).toBe(true); });
    expect(hook.composerMode.kind).toBe('editTurn');
    await act(async () => { expect(await hook.beginEditFollowUp('followup')).toBe(true); });
    expect(hook.composerMode).toEqual({ kind: 'editFollowUp', inputId: 'followup', version: 1 });
    await act(async () => { expect(await hook.beginEditTurn('turn')).toBe(true); });
    expect(hook.editingFollowUpId).toBeNull();
    expect(hook.control.paused).toBe(true);
  });
  it('preserves the editing target on version conflict or external consumption', async () => {
    await act(async () => { await hook.beginEditFollowUp('followup'); });
    failSave = true;
    await act(async () => { await expect(hook.commitEditFollowUp('followup', 'My draft')).rejects.toThrow('Input changed'); });
    expect(hook.editingFollowUpId).toBe('followup');
    state = { ...state, revision: state.revision + 1, inputs: [] };
    act(() => window.dispatchEvent(new CustomEvent('session-input-state', { detail: state })));
    expect(hook.editingFollowUpId).toBe('followup');
    expect(hook.pendingFollowUps).toEqual([]);
  });
  it('does not exit a newer editor when an older save completes', async () => {
    await act(async () => { await hook.beginEditFollowUp('followup'); });
    let reply!: (value: Response) => void;
    vi.mocked(apiFetch).mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }));
    const saving = hook.commitEditFollowUp('followup', 'Edited');
    act(() => hook.restoreEditor({ kind: 'editTurn', turnId: 'other' }));
    await act(async () => { reply(Response.json({ payload: state })); await saving; });
    expect(hook.composerMode).toEqual({ kind: 'editTurn', turnId: 'other' });
  });
  it('does not adopt a newer remote row version when its own save reply arrives late', async () => {
    await act(async () => { await hook.beginEditFollowUp('followup'); });
    let reply!: (value: Response) => void;
    vi.mocked(apiFetch).mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }));
    const saving = hook.commitEditFollowUp('followup', 'My saved text');
    const saved = { ...state, revision: state.revision + 1,
      inputs: [{ id: 'followup', clientMessageId: 'f', content: 'My saved text', status: 'queued', effectiveDelivery: 'next', version: 2 }] };
    const remote = { ...saved, revision: saved.revision + 1, inputs: [{ ...saved.inputs[0], content: 'Other device text', version: 3 }] };
    act(() => window.dispatchEvent(new CustomEvent('session-input-state', { detail: remote })));
    await act(async () => { reply(Response.json({ payload: saved })); await saving; });
    expect(hook.composerMode).toMatchObject({ kind: 'editFollowUp', version: 2 });
    expect(hook.pendingFollowUps[0]).toMatchObject({ text: 'Other device text', version: 3 });
  });

  it.each([false, true])('ignores a control reply after leaving its editor scope (return to original=%s)', returnToOriginal => {
    return (async () => {
      let reply!: (value: Response) => void;
      vi.mocked(apiFetch).mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }));
      const editing = hook.beginEditTurn('old-turn');
      await act(async () => {});
      options.conversationId = 'other'; options.decodedKey = 'other'; options.conversationIdRef.current = 'other';
      await act(async () => root.render(<Harness />));
      if (returnToOriginal) {
        options.conversationId = id; options.decodedKey = id; options.conversationIdRef.current = id;
        await act(async () => root.render(<Harness />));
      }
      await act(async () => {
        reply(Response.json({ payload: { ...state, revision: 10, control: { ...state.control, paused: true, version: 1 } } }));
        expect(await editing).toBe(false);
      });
      expect(hook.composerMode.kind).toBe('compose');
      expect(hook.controlPending).toBe(false);
    })();
  });

  it('refuses to enter editing when another device resumes before the pause reply arrives', async () => {
    useChatSessionStore.getState().setShellError(null);
    const original = vi.mocked(apiFetch).getMockImplementation()!;
    vi.mocked(apiFetch).mockImplementation(async (url, init) => {
      if (String(url).endsWith('/input-control')) {
        state = { ...state, revision: 3, control: { ...state.control, paused: false, version: 2 } };
        return Response.json({ payload: state });
      }
      return original(url, init);
    });
    await act(async () => { expect(await hook.beginEditFollowUp('followup')).toBe(false); });
    expect(hook.composerMode.kind).toBe('compose');
    expect(hook.control.paused).toBe(false);
    expect(useChatSessionStore.getState().shellError).toBeNull();
    expect(showComposerNotification).toHaveBeenCalledWith('error', 'Queue control changed on another device');
  });

  it('ignores a save reply after switching conversations', async () => {
    await act(async () => { await hook.beginEditFollowUp('followup'); });
    let reply!: (value: Response) => void;
    vi.mocked(apiFetch).mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }));
    const saving = hook.commitEditFollowUp('followup', 'Edited');
    options.conversationId = 'other'; options.decodedKey = 'other'; options.conversationIdRef.current = 'other';
    await act(async () => root.render(<Harness />));
    await act(async () => { reply(Response.json({ payload: state })); expect(await saving).toBe(false); });
    expect(hook.composerMode.kind).toBe('compose');
  });

});

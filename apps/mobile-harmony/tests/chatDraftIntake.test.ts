import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { XopcChatDraftIntake } from '../entry/src/main/ets/service/chatDraftIntake.ets';

vi.hoisted(() => Object.assign(globalThis, { ObservedV2: (value: unknown) => value, Trace: () => undefined }));

function handler(file: string, start: string, end: string, deps: Record<string, unknown> = {}) {
  const source = readFileSync(new URL(`../entry/src/main/ets/view/${file}.ets`, import.meta.url), 'utf8');
  const methods = source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const compiled = ts.transpileModule(`class Handler { ${methods} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const Handler = new Function(...Object.keys(deps), `${compiled}; return Handler;`)(...Object.values(deps));
  return new Handler();
}

describe('chat entry handoff', () => {
  function home() {
    const view = handler('HomeView', '  private async openOrdinaryChat(', '  private openConversationFromList(', {
      userErrorMessage: (message: string) => message,
    });
    Object.assign(view, {
      ordinaryOpening: false, navigationRevision: 1, disposed: false,
      chatRepository: { create: vi.fn(async () => 'conversation') }, openConversationFromList: vi.fn(),
      getUIContext: () => ({ getPromptAction: () => ({ showToast: vi.fn() }) }),
    });
    return view;
  }

  it('opens one local conversation draft when the new conversation button is tapped twice', async () => {
    const view = home();
    await Promise.all([view.openOrdinaryChat(), view.openOrdinaryChat()]);
    expect(view.chatRepository.create).toHaveBeenCalledOnce();
    expect(view.openConversationFromList).toHaveBeenCalledExactlyOnceWith('conversation');
  });

  it('ignores an outgoing draft request after the user changes destination', async () => {
    const view = home();
    const pending = view.openOrdinaryChat();
    view.navigationRevision++;
    await pending;
    expect(view.openConversationFromList).not.toHaveBeenCalled();
    expect(view.ordinaryOpening).toBe(false);
  });

  it('stages understanding context for review without sending it', async () => {
    const intake = new XopcChatDraftIntake();
    const view = handler('ChatView', '  applyDraftHandoff(', '  private async send(', {
      gatewaySession: { currentProfile: () => ({ gatewayId: 'gateway', deviceId: 'device' }) },
    });
    Object.assign(view, {
      activePage: true, embedded: false, restoringDraft: false, requestedId: 'conversation',
      chat: { selectedId: 'conversation', connection: 'connected', sending: false, loading: false },
      options: { loading: false, modelId: 'provider/model' },
      draftScope: JSON.stringify(['gateway', 'device', 'conversation']), draftIntake: intake,
      saveDraft: vi.fn(), send: vi.fn(), focusMountedComposer: vi.fn(),
    });
    const refs = [{
      kind: 'user_assertion', sourceId: 'assertion', title: 'Prefers concise replies', expectedVersion: '42',
    }];
    intake.stage('conversation', 'I want to change this understanding to:', refs);
    view.applyDraftHandoff();
    view.applyDraftHandoff();
    expect(view.draft).toBe('I want to change this understanding to:');
    expect(view.refs).toEqual(refs);
    expect(view.saveDraft).toHaveBeenCalledOnce();
    expect(view.focusMountedComposer).toHaveBeenCalledOnce();
    expect(view.send).not.toHaveBeenCalled();
  });
});

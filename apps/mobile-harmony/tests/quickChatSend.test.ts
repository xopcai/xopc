import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { XopcQuickChatIntake } from '../entry/src/main/ets/service/quickChatIntake.ets';

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

const file = { type: 'image', name: 'photo.png', mimeType: 'image/png', size: 5, data: 'encoded' };
function home() {
  const intake = new XopcQuickChatIntake();
  const view = handler('HomeView', '  private async sendQuickDraft(', '  private async openQuickChat(', {
    quickChatIntake: intake,
    userErrorMessage: (message: string) => message,
  });
  Object.assign(view, {
    quickDraft: 'hello', quickFiles: [], quickSending: false, quickPicking: false,
    chatRepository: { create: vi.fn(async () => 'conversation') }, switchToChat: vi.fn(),
    setQuickPanel: vi.fn(),
    getUIContext: () => ({ getPromptAction: () => ({ showToast: vi.fn() }) }),
  });
  return { view, intake };
}

describe('secondary tab direct send', () => {
  it.each(['text', 'attachment', 'mixed'])('hands off %s exactly once as a submission, not a draft', async (kind) => {
    const { view, intake } = home();
    view.quickDraft = kind === 'attachment' ? '' : 'hello';
    view.quickFiles = kind === 'text' ? [] : [file];
    await view.sendQuickDraft();
    expect(intake.consume('unrelated')).toBeUndefined();
    expect(intake.consume('conversation')).toEqual({
      conversationId: 'conversation',
      text: kind === 'attachment' ? '' : 'hello',
      files: kind === 'text' ? [] : [file],
      refs: [],
      autoSend: true,
    });
    expect(intake.consume('conversation')).toBeUndefined();
    expect(view.switchToChat).toHaveBeenCalledWith('conversation', '');
    expect(view.quickDraft).toBe('');
    expect(view.quickFiles).toEqual([]);
  });

  it('ignores duplicate taps while creating the conversation', async () => {
    const { view } = home();
    await Promise.all([view.sendQuickDraft(), view.sendQuickDraft()]);
    expect(view.chatRepository.create).toHaveBeenCalledOnce();
    expect(view.switchToChat).toHaveBeenCalledOnce();
  });

  it('retains content if conversation creation fails', async () => {
    const { view, intake } = home();
    view.quickFiles = [file];
    view.chatRepository.create.mockRejectedValue(new Error('offline'));
    await view.sendQuickDraft();
    expect(view.quickDraft).toBe('hello');
    expect(view.quickFiles).toEqual([file]);
    expect(view.quickSending).toBe(false);
    expect(view.switchToChat).not.toHaveBeenCalled();
    expect(intake.consume('conversation')).toBeUndefined();
  });

  it('waits for chat restoration, then submits once and keeps failed content for manual retry', async () => {
    const intake = new XopcQuickChatIntake();
    const view = handler('ChatView', '  async sendQuickSubmission(', '  private async send(', {
      gatewaySession: { currentProfile: () => ({ gatewayId: 'gateway', deviceId: 'device' }) },
    });
    Object.assign(view, {
      activePage: true, embedded: false, restoringDraft: true, requestedId: 'conversation',
      chat: { selectedId: 'conversation', connection: 'connected', sending: false, loading: false },
      options: { loading: false, modelId: 'provider/model' },
      draftScope: JSON.stringify(['gateway', 'device', 'conversation']), quickIntake: intake,
      saveDraft: vi.fn(), send: vi.fn(async () => false),
    });
    intake.enqueue('conversation', 'hello', [file]);
    await view.sendQuickSubmission();
    expect(view.send).not.toHaveBeenCalled();
    view.restoringDraft = false;
    view.chat.connection = 'disconnected';
    await view.sendQuickSubmission();
    expect(view.send).not.toHaveBeenCalled();
    view.chat.connection = 'connected';
    await Promise.all([view.sendQuickSubmission(), view.sendQuickSubmission()]);
    expect(view.send).toHaveBeenCalledOnce();
    expect(view.saveDraft).toHaveBeenCalledOnce();
    expect(view.draft).toBe('hello');
    expect(view.attachments).toEqual([file]);
  });

  it('stages understanding context for review without sending it', async () => {
    const intake = new XopcQuickChatIntake();
    const view = handler('ChatView', '  async sendQuickSubmission(', '  private async send(', {
      gatewaySession: { currentProfile: () => ({ gatewayId: 'gateway', deviceId: 'device' }) },
    });
    Object.assign(view, {
      activePage: true, embedded: false, restoringDraft: false, requestedId: 'conversation',
      chat: { selectedId: 'conversation', connection: 'connected', sending: false, loading: false },
      options: { loading: false, modelId: 'provider/model' },
      draftScope: JSON.stringify(['gateway', 'device', 'conversation']), quickIntake: intake,
      saveDraft: vi.fn(), send: vi.fn(), focusMountedComposer: vi.fn(),
    });
    const refs = [{
      kind: 'user_assertion', sourceId: 'assertion', title: 'Prefers concise replies', expectedVersion: '42',
    }];
    intake.stage('conversation', 'I want to change this understanding to:', refs);
    await view.sendQuickSubmission();
    expect(view.draft).toBe('I want to change this understanding to:');
    expect(view.refs).toEqual(refs);
    expect(view.saveDraft).toHaveBeenCalledOnce();
    expect(view.focusMountedComposer).toHaveBeenCalledOnce();
    expect(view.send).not.toHaveBeenCalled();
  });
});

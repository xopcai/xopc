// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useComposerActions, type UseComposerActionsOptions } from '../use-composer-actions';
import type { ComposerSendAccepted } from '../composer.types';

vi.mock('../composer-notifications', () => ({ showComposerNotification: vi.fn() }));

describe('composer acceptance preserves drafts', () => {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  let options: UseComposerActionsOptions;
  let actions: ReturnType<typeof useComposerActions>;
  let accept: (value: boolean) => void;
  function Harness() { actions = useComposerActions(options); return null; }
  const render = () => act(async () => root.render(<Harness />));

  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    options = {
      chat: {} as UseComposerActionsOptions['chat'], runBusy: false,
      voiceActive: false, cancelVoiceInput: vi.fn(), editingFollowUpId: null,
      getTextValue: () => 'Original', getAttachmentCount: () => 0,
      wireAttachmentsPayload: () => [], getContextRefs: () => [], getThinkingLevel: () => 'off',
      onSend: () => new Promise<boolean>(resolve => { accept = resolve; }),
      onCommitEditFollowUp: vi.fn(), onPendingFollowUpRemove: vi.fn(), pendingFollowUpsCount: 0,
      resetEditor: vi.fn(), clearAttachments: vi.fn(), clearContextRefs: vi.fn(), clearEditFollowUpRef: vi.fn(),
    };
    await render();
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it('prioritizes personal follow-ups by default and preserves an explicit defer action', async () => {
    const onAddPendingFollowUp = vi.fn(async () => {});
    options = { ...options, personal: true, runBusy: true, onAddPendingFollowUp };
    await render();
    await act(async () => actions.flushSteeringDraft());
    expect(onAddPendingFollowUp).toHaveBeenLastCalledWith('Original', undefined, undefined, true);
    await act(async () => actions.flushSteeringDraft(false));
    expect(onAddPendingFollowUp).toHaveBeenLastCalledWith('Original', undefined, undefined, false);
  });

  it('requests cooperative steering without interrupting a personal reply', async () => {
    const onAddPendingFollowUp = vi.fn(async () => {});
    options = { ...options, personal: true, runBusy: true, onAddPendingFollowUp };
    await render();
    await act(async () => actions.flushSteeringDraft(false, 'steer'));
    expect(onAddPendingFollowUp).toHaveBeenCalledWith('Original', undefined, undefined, false, 'steer');
    expect(options.resetEditor).toHaveBeenCalledOnce();
  });

  it.each([false, true])('steers the first queued input and preserves the whole draft (personal=%s)', async personal => {
    const onSteerPendingFollowUp = vi.fn();
    const onAddPendingFollowUp = vi.fn();
    options = { ...options, personal, runBusy: true, pendingFollowUpsCount: 2,
      firstPendingFollowUpId: 'first', onSteerPendingFollowUp, onAddPendingFollowUp,
      wireAttachmentsPayload: () => [{ type: 'file', name: 'draft.pdf' }],
      getContextRefs: () => [{ kind: 'note', sourceId: 'note', title: 'Draft note', expectedVersion: '1' }] };
    await render();
    act(() => actions.steerCurrentReply());
    expect(onSteerPendingFollowUp).toHaveBeenCalledExactlyOnceWith('first');
    expect(onAddPendingFollowUp).not.toHaveBeenCalled();
    expect(options.resetEditor).not.toHaveBeenCalled();
    expect(options.clearAttachments).not.toHaveBeenCalled();
    expect(options.clearContextRefs).not.toHaveBeenCalled();
  });

  it.each(['text', 'attachment', 'reference'])('steers a %s draft cooperatively when the queue is empty', async kind => {
    const onAddPendingFollowUp = vi.fn(async () => {});
    options = { ...options, personal: true, runBusy: true, onAddPendingFollowUp };
    if (kind !== 'text') options.getTextValue = () => '';
    if (kind === 'attachment') {
      options.getAttachmentCount = () => 1;
      options.wireAttachmentsPayload = () => [{ type: 'file', name: 'draft.pdf' }];
    }
    if (kind === 'reference') options.getContextRefs = () => [{ kind: 'note', sourceId: 'note', title: 'Note', expectedVersion: '1' }];
    await render();
    await act(async () => actions.steerCurrentReply());
    expect(onAddPendingFollowUp).toHaveBeenCalledExactlyOnceWith(options.getTextValue(),
      kind === 'attachment' ? options.wireAttachmentsPayload() : undefined,
      kind === 'reference' ? options.getContextRefs() : undefined, false, 'steer');
  });

  it.each(['idle', 'blocked', 'voice', 'edit-follow-up', 'edit-turn', 'steering'])('ignores shared steer while %s', async mode => {
    const onSteerPendingFollowUp = vi.fn();
    const onAddPendingFollowUp = vi.fn();
    options = { ...options, runBusy: mode !== 'idle', pendingFollowUpsCount: 1,
      firstPendingFollowUpId: 'first', onSteerPendingFollowUp, onAddPendingFollowUp,
      blocked: mode === 'blocked', voiceActive: mode === 'voice', steeringPending: mode === 'steering',
      editingFollowUpId: mode === 'edit-follow-up' ? 'edit' : null,
      editingUserTurnId: mode === 'edit-turn' ? 'turn' : null };
    await render();
    act(() => actions.steerCurrentReply());
    expect(onSteerPendingFollowUp).not.toHaveBeenCalled();
    expect(onAddPendingFollowUp).not.toHaveBeenCalled();
  });

  it('waits for interrupt acceptance and suppresses repeated submissions', async () => {
    let resolve!: (accepted: boolean) => void;
    const onSteeringInterrupt = vi.fn(() => new Promise<boolean>(done => { resolve = done; }));
    options = { ...options, runBusy: true, onSteeringInterrupt };
    await render();
    await act(async () => { actions.interruptDraft(); actions.interruptDraft(); });
    expect(onSteeringInterrupt).toHaveBeenCalledOnce();
    expect(options.resetEditor).not.toHaveBeenCalled();
    await act(async () => resolve(true));
    expect(options.resetEditor).toHaveBeenCalledOnce();
  });

  it.each(['rejected', 'failed', 'changed', 'switched'])('retains the draft when interrupt is %s', async mode => {
    let resolve!: (accepted: boolean) => void;
    let reject!: (error: Error) => void;
    options = { ...options, runBusy: true, draftScope: { gatewayIdentity: 'gateway', conversationId: 'first' },
      onSteeringInterrupt: () => new Promise<boolean>((done, fail) => { resolve = done; reject = fail; }) };
    await render();
    await act(async () => actions.interruptDraft());
    if (mode === 'changed') options = { ...options, getTextValue: () => 'New draft' };
    if (mode === 'switched') options = { ...options, draftScope: { gatewayIdentity: 'gateway', conversationId: 'second' } };
    await render();
    await act(async () => {
      if (mode === 'failed') reject(new Error('Connection lost'));
      else resolve(mode !== 'rejected');
    });
    expect(options.resetEditor).not.toHaveBeenCalled();
    expect(options.clearAttachments).not.toHaveBeenCalled();
    expect(options.clearContextRefs).not.toHaveBeenCalled();
  });

  it('clears an unchanged draft only after acceptance', async () => {
    actions.send();
    expect(options.resetEditor).not.toHaveBeenCalled();
    await act(async () => accept(true));
    expect(options.resetEditor).toHaveBeenCalledOnce();
    expect(options.clearContextRefs).toHaveBeenCalledOnce();
  });

  it('clears immediately when an existing session accepts the local dispatch', async () => {
    options = { ...options, onSend: () => true };
    await render();

    actions.send();

    expect(options.resetEditor).toHaveBeenCalledOnce();
    expect(options.clearAttachments).toHaveBeenCalledOnce();
  });

  it('reports the accepted optimistic dispatch with its original draft', async () => {
    const onDispatched = vi.fn();
    options = {
      ...options,
      onDispatched,
      onSend: (...args) => {
        args[4]?.onDispatched?.({ clientSubmissionId: 'send-1' });
        return true;
      },
    };
    await render();

    actions.send();

    expect(onDispatched).toHaveBeenCalledWith(
      { clientSubmissionId: 'send-1' },
      { text: 'Original', attachments: [], contextRefs: [] },
    );
  });

  it('retains a rejected draft', async () => {
    actions.send();
    await act(async () => accept(false));
    expect(options.resetEditor).not.toHaveBeenCalled();
  });

  it.each(['created session', 'different session', 'different gateway', 'newer draft', 'existing source'] as const)(
    'settles a project first send with the %s in view', async (scenario) => {
      let resolve!: (result: ComposerSendAccepted) => void;
      options = {
        ...options,
        draftScope: { gatewayIdentity: 'gateway', conversationId: scenario === 'existing source' ? 'previous' : null },
        wireAttachmentsPayload: () => [{ type: 'file', name: 'draft.txt' }],
        getContextRefs: () => [{ kind: 'note', sourceId: 'note', title: 'Note', expectedVersion: '1' }],
        onSend: () => new Promise<ComposerSendAccepted>(done => { resolve = done; }),
      };
      await render();
      actions.send();
      options = {
        ...options,
        draftScope: {
          gatewayIdentity: scenario === 'different gateway' ? 'other-gateway' : 'gateway',
          conversationId: scenario === 'different session' ? 'other-session' : 'created',
        },
        getTextValue: scenario === 'newer draft' ? () => 'New draft' : options.getTextValue,
      };
      await render();
      await act(async () => resolve({ conversationId: 'created' }));

      const expectedClears = scenario === 'created session' ? 1 : 0;
      expect(options.resetEditor).toHaveBeenCalledTimes(expectedClears);
      expect(options.clearAttachments).toHaveBeenCalledTimes(expectedClears);
      expect(options.clearContextRefs).toHaveBeenCalledTimes(expectedClears);
    },
  );

  it('sends a reference-only draft', async () => {
    const onSend = vi.fn(() => true);
    options = {
      ...options,
      getTextValue: () => '',
      getContextRefs: () => [{
        kind: 'file',
        fileKind: 'directory',
        sourceId: 'apps/mobile-ios',
        title: 'mobile-ios',
        expectedVersion: '42',
      }],
      onSend,
    };

    await render();
    actions.send();
    expect(onSend).toHaveBeenCalledWith(
      '',
      undefined,
      'off',
      [expect.objectContaining({ kind: 'file', fileKind: 'directory', sourceId: 'apps/mobile-ios' })],
      { onDispatched: expect.any(Function) },
    );
  });

  it.each(['text', 'attachments', 'references'])('preserves changed %s on late acceptance', async field => {
    actions.send();
    options = { ...options };
    if (field === 'text') options.getTextValue = () => 'New draft';
    if (field === 'attachments') options.wireAttachmentsPayload = () => [{ type: 'file', name: 'new.txt' }];
    if (field === 'references') options.getContextRefs = () => [{ kind: 'note', sourceId: 'new', title: 'New', expectedVersion: '1' }];
    await render();
    await act(async () => accept(true));
    expect(options.resetEditor).not.toHaveBeenCalled();
    expect(options.clearAttachments).not.toHaveBeenCalled();
    expect(options.clearContextRefs).not.toHaveBeenCalled();
  });
  it('replaces the original user turn even when follow-ups are waiting', async () => {
    const onSend = vi.fn(async () => true);
    const onAddPendingFollowUp = vi.fn();
    const onFinishUserEdit = vi.fn();
    options = { ...options, editingUserTurnId: 'original-turn', pendingFollowUpsCount: 2,
      onSend, onAddPendingFollowUp, onFinishUserEdit };
    await render();
    await act(async () => actions.send());
    expect(onSend).toHaveBeenCalledOnce();
    expect(onAddPendingFollowUp).not.toHaveBeenCalled();
    expect(onFinishUserEdit).toHaveBeenCalledOnce();
    expect(options.resetEditor).not.toHaveBeenCalled();
  });

  it('saves a follow-up while AI is running without submitting a new input', async () => {
    const onSend = vi.fn();
    const onAddPendingFollowUp = vi.fn();
    const onFinishFollowUpEdit = vi.fn();
    options = { ...options, runBusy: true, editingFollowUpId: 'follow-up',
      onSend, onAddPendingFollowUp, onCommitEditFollowUp: vi.fn(async () => true), onFinishFollowUpEdit };
    await render();
    await act(async () => actions.send());
    expect(options.onCommitEditFollowUp).toHaveBeenCalledWith('follow-up', 'Original', [], 'off', []);
    expect(onFinishFollowUpEdit).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
    expect(onAddPendingFollowUp).not.toHaveBeenCalled();
  });

  it('retains follow-up editing after rejection and ignores interrupt shortcuts in edit mode', async () => {
    const onSteeringInterrupt = vi.fn();
    const onFinishFollowUpEdit = vi.fn();
    options = { ...options, runBusy: true, editingFollowUpId: 'follow-up', onSteeringInterrupt,
      onCommitEditFollowUp: vi.fn(async () => { throw new Error('Input changed'); }), onFinishFollowUpEdit };
    await render();
    await act(async () => actions.send());
    actions.interruptDraft();
    expect(options.resetEditor).not.toHaveBeenCalled();
    expect(onFinishFollowUpEdit).not.toHaveBeenCalled();
    expect(onSteeringInterrupt).not.toHaveBeenCalled();
  });

  it('does not close an editor or clear a newer draft after late save acceptance', async () => {
    const onFinishFollowUpEdit = vi.fn();
    let saved!: (accepted: boolean) => void;
    options = { ...options, editingFollowUpId: 'follow-up', onFinishFollowUpEdit,
      onCommitEditFollowUp: () => new Promise(resolve => { saved = resolve; }) };
    await render();
    actions.send();
    options = { ...options, getTextValue: () => 'Newer edit' };
    await render();
    await act(async () => saved(true));
    expect(onFinishFollowUpEdit).not.toHaveBeenCalled();
    expect(options.resetEditor).not.toHaveBeenCalled();
  });

  it('preserves all drafts while stopping is unconfirmed', async () => {
    const onSend = vi.fn();
    const onAddPendingFollowUp = vi.fn();
    options = { ...options, blocked: true, onSend, onAddPendingFollowUp };
    await render();
    actions.send(); await actions.flushSteeringDraft(); actions.interruptDraft();
    expect(onSend).not.toHaveBeenCalled();
    expect(onAddPendingFollowUp).not.toHaveBeenCalled();
    expect(options.resetEditor).not.toHaveBeenCalled();
  });

  it.each(['turn', 'followUp'])('blocks restored %s edits after another device resumes the queue', async target => {
    const onSend = vi.fn(); const onCommitEditFollowUp = vi.fn(); const onAddPendingFollowUp = vi.fn();
    options = { ...options, queuePaused: false, editingUserTurnId: target === 'turn' ? 'turn' : undefined,
      editingFollowUpId: target === 'followUp' ? 'follow-up' : null, onSend, onCommitEditFollowUp, onAddPendingFollowUp };
    await render();
    await act(async () => { actions.send(); await actions.flushSteeringDraft(); });
    expect(onSend).not.toHaveBeenCalled();
    expect(onCommitEditFollowUp).not.toHaveBeenCalled();
    expect(onAddPendingFollowUp).not.toHaveBeenCalled();
    expect(options.resetEditor).not.toHaveBeenCalled();
  });

});

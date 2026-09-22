// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useComposerActions, type UseComposerActionsOptions } from '../use-composer-actions';

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

  it('clears an unchanged draft only after acceptance', async () => {
    actions.send();
    expect(options.resetEditor).not.toHaveBeenCalled();
    await act(async () => accept(true));
    expect(options.resetEditor).toHaveBeenCalledOnce();
    expect(options.clearContextRefs).toHaveBeenCalledOnce();
  });

  it('retains a rejected draft', async () => {
    actions.send();
    await act(async () => accept(false));
    expect(options.resetEditor).not.toHaveBeenCalled();
  });

  it('sends a reference-only draft', async () => {
    const onSend = vi.fn(() => true);
    options = {
      ...options,
      getTextValue: () => '',
      getContextRefs: () => [{
        kind: 'file',
        fileKind: 'directory',
        sourceId: 'apps/mobile-expo',
        title: 'mobile-expo',
        expectedVersion: '42',
      }],
      onSend,
    };

    await render();
    actions.send();
    expect(onSend).toHaveBeenCalledWith('', undefined, 'off', [expect.objectContaining({
      kind: 'file', fileKind: 'directory', sourceId: 'apps/mobile-expo',
    })]);
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
});

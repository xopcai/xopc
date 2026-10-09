// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PersonalComposerActions, PersonalComposerAttachButton } from '@/features/chat/composer/personal-composer-controls';
import { messages } from '@/i18n/messages';

const chat = messages('zh').chat;

describe('Personal composer controls', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('sends a draft immediately while busy and stops an empty active run', () => {
    const onSend = vi.fn();
    const onQueue = vi.fn();
    const onAbort = vi.fn();
    const common = { disabled: false, voiceActive: false, chat, onStartVoiceInput: vi.fn(), onSend, onQueue, onAbort, onInterrupt: vi.fn() };

    act(() => root.render(<PersonalComposerActions {...common} runBusy={false} hasDraft />));
    act(() => container.querySelector<HTMLButtonElement>(`button[aria-label="${chat.sendMessage}"]`)?.click());
    expect(onSend).toHaveBeenCalledOnce();

    act(() => root.render(<PersonalComposerActions {...common} runBusy hasDraft />));
    act(() => container.querySelector<HTMLButtonElement>(`button[aria-label="${chat.sendMessage}"]`)?.click());
    expect(onQueue).toHaveBeenCalledOnce();

    act(() => root.render(<PersonalComposerActions {...common} runBusy hasDraft={false} />));
    act(() => container.querySelector<HTMLButtonElement>(`button[aria-label="${chat.abort}"]`)?.click());
    expect(onAbort).toHaveBeenCalledOnce();
  });

  it('keeps attachment availability independent of an active run', () => {
    const onPickFiles = vi.fn();
    act(() => root.render(<PersonalComposerAttachButton disabled={false} attachmentCount={0} maxAttachments={5} chat={chat} onPickFiles={onPickFiles} />));
    act(() => container.querySelector<HTMLButtonElement>('button')?.click());
    expect(onPickFiles).toHaveBeenCalledOnce();

    act(() => root.render(<PersonalComposerAttachButton disabled={false} attachmentCount={5} maxAttachments={5} chat={chat} onPickFiles={onPickFiles} />));
    expect(container.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
  });
});

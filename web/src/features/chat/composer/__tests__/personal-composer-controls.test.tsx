// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComposerRunControl } from '@/features/chat/composer/composer-toolbar';
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

  it.each(['standard', 'personal'])('keeps steer and queue buttons out of the %s toolbar', mode => {
    const props = { disabled: false, voiceActive: false, runBusy: true, hasDraft: true, chat,
      onSend: vi.fn(), onAbort: vi.fn() };
    act(() => root.render(mode === 'personal'
      ? <PersonalComposerActions {...props} onStartVoiceInput={vi.fn()} onQueue={vi.fn()} onSteer={vi.fn()} />
      : <ComposerRunControl {...props} showSteeringInterrupt={false} />));
    expect(container.querySelector(`button[aria-label="${chat.steerCurrentReply}"]`)).toBeNull();
    expect(container.querySelector(`button[aria-label="${chat.followUpQueueAdd}"]`)).toBeNull();
  });

  it.each([false, true])('exposes the same steer action in the Personal menu without a draft (disabled=%s)', async steerDisabled => {
    const onSteer = vi.fn();
    act(() => root.render(<PersonalComposerActions disabled={false} voiceActive={false} runBusy hasDraft={false} chat={chat}
      onSend={vi.fn()} onQueue={vi.fn()} onDefer={vi.fn()} onAbort={vi.fn()} onInterrupt={vi.fn()}
      onStartVoiceInput={vi.fn()} onSteer={onSteer} steerDisabled={steerDisabled} />));
    await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${chat.followUpQueueMore}"]`)!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const steerItem = items.find(item => item.textContent === chat.steerCurrentReply)!;
    expect(steerItem.hasAttribute('data-disabled')).toBe(steerDisabled);
    expect(items.find(item => item.textContent === chat.followUpQueueAdd)?.hasAttribute('data-disabled')).toBe(true);
    expect(items.find(item => item.textContent === chat.steeringInterruptSend)?.hasAttribute('data-disabled')).toBe(true);
    if (!steerDisabled) {
      act(() => steerItem.click());
      expect(onSteer).toHaveBeenCalledOnce();
    }
  });

  it.each(['standard', 'personal'])('hides steer while idle in %s mode', mode => {
    const props = { disabled: false, voiceActive: false, runBusy: false, hasDraft: true, chat,
      onSend: vi.fn(), onAbort: vi.fn(), onSteer: vi.fn() };
    act(() => root.render(mode === 'personal'
      ? <PersonalComposerActions {...props} onStartVoiceInput={vi.fn()} />
      : <ComposerRunControl {...props} showSteeringInterrupt={false} />));
    expect(container.querySelector(`button[aria-label="${chat.steerCurrentReply}"]`)).toBeNull();
  });

  it('labels the personal default as stop and send and stops an empty active run', () => {
    const onSend = vi.fn();
    const onQueue = vi.fn();
    const onAbort = vi.fn();
    const common = { disabled: false, voiceActive: false, chat, onStartVoiceInput: vi.fn(), onSend, onQueue, onAbort, onInterrupt: vi.fn() };

    act(() => root.render(<PersonalComposerActions {...common} runBusy={false} hasDraft />));
    act(() => container.querySelector<HTMLButtonElement>(`button[aria-label="${chat.sendMessage}"]`)?.click());
    expect(onSend).toHaveBeenCalledOnce();

    act(() => root.render(<PersonalComposerActions {...common} runBusy hasDraft />));
    act(() => container.querySelector<HTMLButtonElement>(`button[aria-label="${chat.steeringInterruptSend}"]`)?.click());
    expect(onQueue).toHaveBeenCalledOnce();

    act(() => root.render(<PersonalComposerActions {...common} runBusy hasDraft={false} />));
    act(() => container.querySelector<HTMLButtonElement>(`button[aria-label="${chat.abort}"]`)?.click());
    expect(onAbort).toHaveBeenCalledOnce();
    expect(container.querySelector(`button[aria-label="${chat.followUpQueueTurnOff}"]`)).toBeNull();
    expect(container.querySelector(`button[aria-label="${chat.followUpQueueTurnOn}"]`)).toBeNull();
  });

  it('keeps immediate send and stop in the standard composer', () => {
    const onQueue = vi.fn();
    const onInterrupt = vi.fn();
    const onAbort = vi.fn();
    act(() => root.render(<ComposerRunControl disabled={false} voiceActive={false} runBusy hasDraft
      showSteeringInterrupt chat={chat} onSend={vi.fn()} onInterrupt={onInterrupt} onAbort={onAbort} />));
    for (const label of [chat.steeringInterruptSend, chat.abort]) {
      act(() => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click());
    }
    expect(onQueue).not.toHaveBeenCalled();
    expect(onInterrupt).toHaveBeenCalledOnce();
    expect(onAbort).toHaveBeenCalledOnce();
    expect(container.querySelector('button[aria-pressed]')).toBeNull();
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

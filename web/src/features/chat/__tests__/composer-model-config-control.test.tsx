// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { models } = vi.hoisted(() => ({ models: [
  { id: 'xopc-cloud/auto', name: 'Standard', displayNames: { 'zh-CN': '标准', en: 'Standard' }, provider: 'xopc-cloud', reasoning: false,
    thinking: { mode: 'none', options: ['off'], initialValue: 'off', supportsAdaptive: false } },
  { id: 'test/one', name: 'Model One', provider: 'test', reasoning: true,
    thinking: { mode: 'levels', options: ['low', 'high'], initialValue: 'low', supportsAdaptive: false } },
  { id: 'other/two', name: 'Model Two', provider: 'other', reasoning: false,
    thinking: { mode: 'none', options: ['off'], initialValue: 'off', supportsAdaptive: false } },
  { id: 'fixed/three', name: 'Model Three', provider: 'fixed', reasoning: true,
    thinking: { mode: 'fixed', options: ['high'], initialValue: 'high', supportsAdaptive: false } },
  { id: 'xopc-cloud/openai/gpt-6-luna', name: 'openai/gpt-6-luna', provider: 'xopc-cloud', reasoning: true,
    thinking: { mode: 'levels', options: ['low', 'high'], initialValue: 'low', supportsAdaptive: false } },
] }));
vi.mock('swr', () => ({ default: () => ({ data: models, isLoading: false, mutate: vi.fn() }) }));

import { ComposerToolbar } from '../composer/composer-toolbar';
import { ComposerModelConfigControl } from '../model/composer-model-config-control';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

let root: Root;
let container: HTMLDivElement;
const button = (name: string) => [...document.querySelectorAll('button')].find((element) => element.textContent?.trim() === name)!;
const click = async (element: HTMLElement) => act(async () => element.click());

beforeEach(() => {
  useLocaleStore.setState({ language: 'en' });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function render(props = {}) {
  await act(async () => root.render(<MemoryRouter><ComposerModelConfigControl
    chat={messages('en').chat} sessionModel="test/one" thinkingLevel="high"
    modelDisabled={false} thinkingDisabled={false} onModelChange={vi.fn()} onThinkingChange={vi.fn()} {...props}
  /></MemoryRouter>));
  await click(container.querySelector('button')!);
}

describe('composer model configuration', () => {
  it('updates the current cloud name and picker on locale changes while retaining auto', async () => {
    const change = vi.fn();
    await render({ sessionModel: 'xopc-cloud/auto', onModelChange: change });
    expect(container.querySelector('button')?.textContent).toContain('Standard');
    await act(async () => useLocaleStore.setState({ language: 'zh' }));
    expect(container.querySelector('button')?.textContent).toContain('标准');
    await click(document.querySelector('button[title="xopc-cloud/auto"]') as HTMLButtonElement);
    expect(document.querySelector('[data-select-scroll-region] button[title="xopc-cloud/auto"]')!.getAttribute('aria-pressed')).toBe('true');
    await click(document.querySelector('[data-select-scroll-region] button[title="xopc-cloud/auto"]') as HTMLButtonElement);
    expect(change).toHaveBeenCalledWith('xopc-cloud/auto', 'off');
  });

  it('shows only the model name for a provider-routed model and retains its identity in the picker', async () => {
    await render({ sessionModel: 'xopc-cloud/openai/gpt-6-luna', thinkingLevel: 'low' });
    const trigger = container.querySelector('button')!;
    expect(trigger.textContent).toBe('gpt-6-luna· Low');
    expect(trigger.title).toBe('gpt-6-luna');
    expect(trigger.getAttribute('aria-label')).not.toContain('openai');
    await click(button('gpt-6-luna'));
    expect(button('openai/gpt-6-luna').getAttribute('aria-pressed')).toBe('true');
    const cloudGroup = document.querySelector('[role="group"][aria-label="xopc-cloud"]')!;
    expect(cloudGroup.querySelectorAll('button')).toHaveLength(2);
    expect([...document.querySelectorAll('[data-select-scroll-region] [role="group"]')].map(group => group.getAttribute('aria-label'))).toEqual(['xopc-cloud', 'test', 'other', 'fixed']);
  });

  it('shows concrete identity and only supported thinking levels in one popover', async () => {
    await render();
    expect(container.textContent).toContain('Model One');
    const slider = document.querySelector('input[type=range]') as HTMLInputElement;
    expect(slider.value).toBe('1');
    expect(slider.max).toBe('1');
    expect(slider.getAttribute('aria-valuetext')).toBe('High');
    expect(document.body.textContent).not.toContain('Thinking effort');
    expect(document.body.textContent).not.toContain('Manage models');
    expect(document.body.textContent).not.toContain('test');
    expect(document.body.textContent).not.toContain('Default');
    expect(document.querySelector('input[type=range]')).toBeTruthy();
    await click([...document.querySelectorAll('button')].find((item) => item.textContent === 'Model One')!);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.body.textContent).toContain('Model Two');
  });

  it('keeps the previous selection and surfaces a failed save', async () => {
    const change = vi.fn(async () => { throw new Error('Configuration changed elsewhere'); });
    await render({ onThinkingChange: change });
    const slider = document.querySelector('input[type=range]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '0');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(change).not.toHaveBeenCalled();
    await act(async () => { slider.dispatchEvent(new Event('pointerup', { bubbles: true })); });
    expect(change).toHaveBeenCalledWith('low');
    expect(slider.value).toBe('1');
    expect(slider.getAttribute('aria-valuetext')).toBe('High');
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Configuration changed elsewhere');
  });

  it('commits keyboard selection and disables the slider while configuration is locked', async () => {
    const change = vi.fn();
    await render({ onThinkingChange: change });
    const slider = document.querySelector('input[type=range]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '0');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { slider.dispatchEvent(new KeyboardEvent('keyup', { key: 'Home', bubbles: true })); });
    expect(change).toHaveBeenCalledWith('low');
    await render({ thinkingDisabled: true });
    await click(container.querySelector('button')!);
    expect((document.querySelector('input[type=range]') as HTMLInputElement).disabled).toBe(true);
  });

  it('offers the model default reset without adding a save confirmation row', async () => {
    const change = vi.fn();
    await render({ thinkingLevel: 'high', onThinkingChange: change });
    await click(document.querySelector('button[aria-label="Reset thinking effort"]') as HTMLButtonElement);
    expect(change).toHaveBeenCalledWith('low');
    expect(document.body.textContent).not.toContain('Configuration updated');
  });

  it('retains the dragged selection during saving and commits only once on pointer release and blur', async () => {
    let finish!: () => void;
    const change = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    await render({ onThinkingChange: change });
    const slider = document.querySelector('input[type=range]') as HTMLInputElement;
    await act(async () => {
      slider.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '0');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      slider.dispatchEvent(new Event('pointerup', { bubbles: true }));
      slider.blur();
    });
    expect(change).toHaveBeenCalledOnce();
    expect(slider.value).toBe('0');
    expect(slider.getAttribute('aria-valuetext')).toBe('Low');
    expect(slider.disabled).toBe(true);
    await act(async () => { finish(); });
  });

  it('blocks sending without disabling attachments or voice while a model choice is saving', async () => {
    const props = {
      disabled: false, sendDisabled: true, sending: false, streaming: false, runBusy: false,
      chat: messages('en').chat, hasDraft: true, showSteeringInterrupt: false, attachmentCount: 0,
      maxAttachments: 10, onPickFiles: vi.fn(), thinkingLevel: 'high', onThinkingChange: vi.fn(),
      voiceActive: false, onStartVoiceInput: vi.fn(), voiceConversationEnabled: true,
      onStartVoiceConversation: vi.fn(), onSend: vi.fn(), onAbort: vi.fn(),
      sessionModel: 'test/one', showModelSelector: true, onModelChange: vi.fn(), modelDisabled: true,
    };
    await act(async () => root.render(<MemoryRouter><ComposerToolbar {...props} /></MemoryRouter>));
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons[0].disabled).toBe(false);
    expect(buttons.find(item => item.getAttribute('aria-label') === messages('en').chat.sendMessage)?.disabled).toBe(true);
    expect(buttons.find(item => item.getAttribute('aria-label') === messages('en').chat.voiceConversation)?.disabled).toBe(false);
  });

  it('keeps an unavailable model visible and permits choosing a replacement', async () => {
    await render({ sessionModel: 'removed/original' });
    expect(container.textContent).toContain('original');
    expect(container.textContent).toContain('Unavailable');
    expect(document.querySelector('input[type=range]')).toBeNull();
  });

  it('shows always-on reasoning as fixed instead of unsupported', async () => {
    await render({ sessionModel: 'fixed/three', thinkingLevel: 'off' });
    expect(container.querySelector('button')?.textContent).toBe('Model Three· Always on');
    expect(document.body.textContent).toContain('Always on');
    expect(document.body.textContent).not.toContain('Not supported by this model');
    expect(document.querySelector('input[type=range]')).toBeNull();
    const popover = document.querySelector('[role="dialog"]');
    expect(popover?.className).toContain('max-h-[min(21rem,calc(100dvh-3rem))]');
    expect(popover?.className).not.toContain(' h-[min(21rem,calc(100dvh-3rem))]');
    expect(popover?.querySelector('[aria-live="polite"]')).toBeNull();
  });
});

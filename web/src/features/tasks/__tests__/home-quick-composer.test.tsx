// @vitest-environment jsdom

import { act, createRef, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UseComposerVoiceInputReturn } from '@/features/chat/composer/use-composer-voice-input';
import { HomeQuickComposer, type HomeQuickComposerProps } from '@/features/tasks/home-quick-composer';
import { messages } from '@/i18n/messages';

function createVoice(
  overrides: Partial<UseComposerVoiceInputReturn> = {},
): UseComposerVoiceInputReturn {
  return {
    phase: 'idle',
    voiceActive: false,
    elapsedLabel: '0:00',
    audioLevel: 0,
    readiness: { state: 'ready' },
    hasRetainedRecording: false,
    startVoiceInput: vi.fn(async () => {}),
    cancelVoiceInput: vi.fn(),
    confirmVoiceInput: vi.fn(),
    retryVoiceInput: vi.fn(),
    ...overrides,
  };
}

describe('HomeQuickComposer', () => {
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

  function renderComposer(overrides: Partial<HomeQuickComposerProps> = {}) {
    const props: HomeQuickComposerProps = {
      variant: 'inline',
      inputId: 'home-intent',
      inputRef: createRef<HTMLTextAreaElement>(),
      intent: '',
      labels: {
        attachTitle: 'Attach files',
        dropFiles: 'Drop files',
        intentLabel: 'Intent',
        intentPlaceholder: 'What should xopc do?',
        intentSuggestion: 'Summarize the meeting',
        shortcut: 'Ctrl + Enter',
        submit: 'Ask xopc',
      },
      attachments: [],
      isDragging: false,
      attachmentBusy: false,
      attachmentsFull: false,
      voice: createVoice(),
      chat: messages('en').chat,
      onIntentChange: vi.fn(),
      onPickFiles: vi.fn(),
      onRemoveAttachment: vi.fn(),
      onPaste: vi.fn(),
      onDragOver: vi.fn(),
      onDragLeave: vi.fn(),
      onDrop: vi.fn(),
      onSubmit: vi.fn((event) => event.preventDefault()),
      ...overrides,
    };
    act(() => root.render(<HomeQuickComposer {...props} />));
    return props;
  }

  it('keeps text, attachment, and voice entry points available in the idle state', () => {
    renderComposer();

    expect(container.querySelector('textarea')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Attach files"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label^="Voice input"]')).not.toBeNull();
    expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the shared recording bar, retains the editor, and blocks submission', () => {
    const voice = createVoice({
      phase: 'recording',
      voiceActive: true,
      elapsedLabel: '0:08',
      audioLevel: 0.5,
    });
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    renderComposer({ intent: 'Existing draft', voice, onSubmit });

    const editor = container.querySelector('textarea');
    expect(editor?.classList.contains('hidden')).toBe(true);
    expect(container.textContent).toContain(messages('en').chat.voiceRecordingStatus);
    expect(container.textContent).toContain('0:08');
    expect(container.querySelector('button[aria-label^="Voice input"]')).toBeNull();
    expect((container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);

    act(() => {
      container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('enables submission for text after voice input returns to idle', () => {
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    renderComposer({ intent: 'Transcribed request', onSubmit });

    const submit = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    act(() => submit.click());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom

import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messages } from '@/i18n/messages';

import { ComposerVoiceInputBar } from '../composer-voice-input-bar';

describe('ComposerVoiceInputBar', () => {
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

  function render(props: { error: string; settingsRequired: boolean }) {
    act(() => root.render(
      <ComposerVoiceInputBar
        phase="error"
        elapsedLabel="0:00"
        audioLevel={0}
        partialTranscript=""
        finalTranscript=""
        error={props.error}
        settingsRequired={props.settingsRequired}
        chat={messages('zh').chat}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        onRetry={vi.fn()}
      />,
    ));
  }

  it('shows the configuration message and a direct voice-settings action', () => {
    render({
      error: messages('zh').chat.voiceSttNotConfigured,
      settingsRequired: true,
    });

    expect(container.textContent).toContain('语音转文字尚未配置');
    const settingsLink = container.querySelector<HTMLAnchorElement>('a[href="#/settings/capabilities/voice"]');
    expect(settingsLink?.textContent).toContain('去设置');
    expect(container.querySelector('button[aria-label="重新转写"]')).toBeNull();
  });

  it('keeps retry available for a transcription failure', () => {
    render({ error: '转写服务暂时不可用', settingsRequired: false });

    expect(container.textContent).toContain('转写服务暂时不可用');
    expect(container.querySelector('a[href="#/settings/capabilities/voice"]')).toBeNull();
    expect(container.querySelector('button[aria-label="重新转写"]')).not.toBeNull();
  });
});

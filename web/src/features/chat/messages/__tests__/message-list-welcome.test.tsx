// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/chat/messages/message-bubble', () => ({
  MessageBubble: () => <div />,
}));

import { MessageList } from '@/features/chat/messages/message-list';
import { buildWelcomeSpotlight } from '@/features/chat/welcome/welcome-suggestions';
import { messages } from '@/i18n/messages';

describe('MessageList welcome state', () => {
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

  function renderWelcome(spotlight: ReturnType<typeof buildWelcomeSpotlight>, onPick = vi.fn()) {
    act(() => {
      root.render(
        <MessageList
          messages={[]}
          streaming={false}
          progress={null}
          reasoningLevel="stream"
          registerListContentRef={() => {}}
          onPickWelcomePrompt={onPick}
          welcomeSpotlight={spotlight}
        />,
      );
    });
    return onPick;
  }

  it('renders a quiet empty state without generic suggestions', () => {
    const spotlight = buildWelcomeSpotlight({ kind: 'empty' }, messages('zh').chat.welcomeSpotlight);

    renderWelcome(spotlight);

    expect(container.textContent).toContain('今天想推进什么？');
    expect(container.textContent).not.toContain('办公输出');
    expect(container.textContent).not.toContain('写作润色');
    expect(container.querySelector('[data-loopi="ceramic-v4"]')).not.toBeNull();
    expect(container.innerHTML).toContain('sm:size-32');
    expect(container.innerHTML).toContain('sm:pt-36');
    expect(container.innerHTML).toContain('max-height:800px)]:pt-12');
  });

  it('shows one explainable action when the next step is explicit', () => {
    const spotlight = buildWelcomeSpotlight({
      kind: 'project',
      projectId: 'project-1',
      projectName: 'xopc',
      recentFailure: '类型检查失败',
    }, messages('zh').chat.welcomeSpotlight);
    const onPick = renderWelcome(spotlight);

    expect(container.textContent).toContain('解决最近的失败：类型检查失败');
    expect(container.textContent).toContain('xopc 项目 · 最近一次失败');
    const recommendation = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes('类型检查失败'),
    );
    expect(recommendation).toBeTruthy();

    act(() => recommendation?.click());

    expect(onPick).toHaveBeenCalledWith({
      suggestionId: 'project-failure',
      contextKind: 'project',
      prompt: expect.stringContaining('类型检查失败'),
    });
  });
});

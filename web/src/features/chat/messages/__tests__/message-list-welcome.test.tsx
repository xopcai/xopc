// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/chat/messages/message-bubble', () => ({
  MessageBubble: () => <div />,
}));

import { MessageList } from '@/features/chat/messages/message-list';
import { buildWelcomeSpotlight } from '@/features/chat/welcome/welcome-suggestions';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';

vi.mock('@/features/projects/api', () => ({
  fetchProjects: vi.fn().mockResolvedValue({ items: [{ id: 'project-1', name: 'Project' }] }),
}));
vi.mock('@/features/work-discovery/api', () => ({
  fetchWorkDiscoveryOnboarding: vi.fn().mockResolvedValue(null),
}));

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

  it('hides project selection when a project is selected before welcome context loads', async () => {
    const previousToken = useGatewayStore.getState().token;
    useGatewayStore.setState({ token: 'test' });
    const welcomeSpotlight = buildWelcomeSpotlight({ kind: 'empty' }, messages('zh').chat.welcomeSpotlight, { id: 'main' });
    const render = async (projectId?: string) => act(async () => {
      root.render(
        <MemoryRouter>
          <MessageList
            messages={[]}
            streaming={false}
            progress={null}
            reasoningLevel="stream"
            registerListContentRef={() => {}}
            onPickWelcomePrompt={() => {}}
            onSelectWelcomeProject={() => {}}
            welcomeSpotlight={welcomeSpotlight}
            projectId={projectId}
          />
        </MemoryRouter>,
      );
    });
    try {
      await render();
      expect(container.textContent).toContain(messages('en').onboarding.workDiscovery.selectProject);
      await render('project-1');
      expect(container.textContent).not.toContain(messages('en').onboarding.workDiscovery.selectProject);
      expect(container.textContent).toContain('办公输出');
      await render();
      expect(container.textContent).toContain(messages('en').onboarding.workDiscovery.selectProject);
    } finally {
      await act(async () => useGatewayStore.setState({ token: previousToken }));
    }
  });

  it('renders three flat, directly actionable suggestions for an empty non-streaming chat', () => {
    const copy = messages('zh').chat.welcomeSpotlight;
    const welcomeSpotlight = buildWelcomeSpotlight({ kind: 'empty' }, copy, { id: 'main' });
    const workCategory = welcomeSpotlight.categories.find((category) => category.id === 'work');
    if (workCategory) {
      workCategory.scenarios.push(
        { id: 'work:extra-1', prompt: '帮我整理一份项目同步材料。' },
        { id: 'work:extra-2', prompt: '帮我准备一次复盘会议。' },
      );
    }
    const onPickWelcomePrompt = vi.fn();
    const onRefreshWelcomeExploration = vi.fn();

    act(() => {
      root.render(
        <MemoryRouter>
          <MessageList
            messages={[]}
            streaming={false}
            progress={null}
            reasoningLevel="stream"
            registerListContentRef={() => {}}
            onPickWelcomePrompt={onPickWelcomePrompt}
            onRefreshWelcomeExploration={onRefreshWelcomeExploration}
            welcomeSpotlight={welcomeSpotlight}
          />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain('今天想推进什么？');
    expect(container.textContent).toContain('办公输出');
    expect(container.textContent).toContain('写作润色');
    expect(container.textContent).toContain('学习新主题');
    expect(container.textContent).not.toContain('建议下一步');
    expect(container.textContent).not.toContain(welcomeSpotlight.primaryRecommendation.prompt);

    const refreshExplorationButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="换一个探索方向"]',
    );
    expect(refreshExplorationButton).toBeTruthy();
    expect(
      refreshExplorationButton?.closest('[data-welcome-suggestion-scope="explore"]'),
    ).toBeTruthy();
    act(() => refreshExplorationButton?.click());
    expect(onRefreshWelcomeExploration).toHaveBeenCalledOnce();

    const workSuggestionButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('办公输出'),
    );
    expect(workSuggestionButton).toBeTruthy();
    expect(container.querySelector('[role="region"]')).toBeNull();
    act(() => workSuggestionButton?.click());
    expect(onPickWelcomePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryId: 'work',
        prompt: expect.stringContaining('简短周报'),
      }),
    );
  });
});

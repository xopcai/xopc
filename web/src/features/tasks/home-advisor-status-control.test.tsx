// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { HomeAdvisorStatusControl, type HomeAdvisorStatusCopy } from './home-advisor-status-control';

const copy: HomeAdvisorStatusCopy = {
  label: 'AI 建议',
  ready: '{{count}} 条可用',
  clarification: '待补充',
  refreshing: '正在分析',
  refreshingDetail: '正在寻找下一步',
  idle: '暂无新建议',
  idleDetail: '暂时还没有生成建议',
  generationFailed: '生成失败',
  budgetExhausted: '今日已用完',
  modelUnavailable: '待配置',
  generationFailedDetail: '上一次建议生成失败了',
  budgetExhaustedDetail: '今天的自动建议次数已用完',
  modelUnavailableDetail: '需要先配置可用的 AI 模型',
  history: '建议记录',
  retry: '重试',
  findAnother: '换一个建议',
};

const mounted: Array<{ container: HTMLDivElement; unmount: () => void }> = [];

beforeAll(() => {
  class TestResizeObserver implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.ResizeObserver = TestResizeObserver;
});

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(entry.unmount);
    entry.container.remove();
  }
});

function renderControl(
  advisor: Parameters<typeof HomeAdvisorStatusControl>[0]['advisor'],
  onOpenHistory = vi.fn(),
  onRefresh = vi.fn(),
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <HomeAdvisorStatusControl
        advisor={advisor}
        busy={false}
        copy={copy}
        onOpenHistory={onOpenHistory}
        onRefresh={onRefresh}
      />,
    );
  });
  mounted.push({ container, unmount: () => root.unmount() });
  return { container, onOpenHistory, onRefresh };
}

describe('HomeAdvisorStatusControl', () => {
  it('keeps an exhausted-generation state in the header popover', async () => {
    const view = renderControl({ state: 'quiet', reason: 'budget_exhausted' });
    const trigger = view.container.querySelector('button');

    expect(trigger?.textContent).toContain('AI 建议 · 今日已用完');

    await act(async () => {
      trigger?.click();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('今天的自动建议次数已用完');
    const buttons = Array.from(document.body.querySelectorAll('button'));
    expect(buttons.some((button) => button.textContent?.includes('建议记录'))).toBe(true);
    expect(buttons.some((button) => button.textContent?.includes('重试'))).toBe(true);
  });

  it('does not render an entry when suggestions are disabled', () => {
    const view = renderControl({ state: 'disabled' });
    expect(view.container.innerHTML).toBe('');
  });
});

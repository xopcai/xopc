// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskCollaborationPanel } from '@/features/tasks/task-collaboration-panel';
import { useLocaleStore } from '@/stores/locale-store';

vi.mock('swr', () => ({
  default: () => ({
    data: { items: [{
      id: 'entry-1', sequence: 1, kind: 'progress', authorKind: 'worker_agent', createdAt: 1,
      body: '## 来源清单\n\n- [OpenAI Memory](https://openai.com/index/memory-and-new-controls-for-chatgpt/)\n- **已核对**\n\n<script>alert(1)</script>',
    }] },
    error: undefined,
    mutate: vi.fn(),
  }),
}));

describe('TaskCollaborationPanel', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.setState({ language: 'zh' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders worker updates as safe Markdown with headings, lists, and links', () => {
    act(() => root.render(<MemoryRouter><TaskCollaborationPanel taskId="task-1" /></MemoryRouter>));
    const body = container.querySelector('[data-task-collaboration-body]');
    expect(body?.querySelector('h2')?.textContent).toBe('来源清单');
    expect(body?.querySelectorAll('li')).toHaveLength(2);
    expect(body?.querySelector('strong')?.textContent).toBe('已核对');
    expect(body?.querySelector('a')?.getAttribute('href'))
      .toBe('https://openai.com/index/memory-and-new-controls-for-chatgpt/');
    expect(body?.querySelector('script')).toBeNull();
  });
});

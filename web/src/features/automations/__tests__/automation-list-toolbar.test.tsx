// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messages } from '@/i18n/messages';
import { AutomationListToolbar } from '../automation-list-toolbar';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const labels = messages('zh').automations;
const changeFilter = vi.fn();
function Harness({ initialQuery = '' }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<'all' | 'paused' | 'completed'>('all');
  return <AutomationListToolbar language="zh" labels={labels} filter={filter} ownership="user" source="all" projectId="" projects={[]} projectLocked={false} query={query} unreadCount={0} markReadBusy={false}
    onQuery={setQuery} onFilter={value => { changeFilter(value); setFilter(value as 'all' | 'paused' | 'completed'); }} onOwnership={vi.fn()} onSource={vi.fn()} onProject={vi.fn()} onClear={vi.fn()} onMarkAllRead={vi.fn()} />;
}
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  changeFilter.mockClear();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('compact task list tools', () => {
  it('keeps search hidden by default and clears and closes it with Escape', async () => {
    await act(async () => root.render(<Harness />));
    expect(container.querySelector('input')).toBeNull();
    expect(container.textContent).not.toContain('搜索与筛选');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="搜索任务"]')!.click());
    const input = container.querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Weekly');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.value).toBe('Weekly');
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('[aria-label="搜索任务"]')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('restores a saved query and changes status through the grouped dropdown', async () => {
    await act(async () => root.render(<Harness initialQuery="report" />));
    expect(container.querySelector('input')?.value).toBe('report');
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="筛选任务"]')!;
    await act(async () => trigger.dispatchEvent(new MouseEvent('pointerdown', { button: 0, ctrlKey: false, bubbles: true })));
    const paused = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')).find(item => item.textContent === labels.paused)!;
    expect(paused).toBeDefined();
    await act(async () => paused.click());
    expect(changeFilter).toHaveBeenCalledWith('paused');
    expect(container.textContent).toContain('已应用筛选');
    await act(async () => trigger.dispatchEvent(new MouseEvent('pointerdown', { button: 0, ctrlKey: false, bubbles: true })));
    const completed = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')).find(item => item.textContent === '已完成')!;
    await act(async () => completed.click());
    expect(changeFilter).toHaveBeenLastCalledWith('completed');
  });
});

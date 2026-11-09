// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ObservationState } from '@xopcai/gateway-contract';

import { HomeObservationCard } from './home-observation-card';

const fetchJson = vi.hoisted(() => vi.fn());
vi.mock('@/lib/fetch', () => ({ fetchJson }));
vi.mock('./home-task-review', () => ({ HomeTaskReview: ({ taskId }: { taskId: string }) => <div>Trial review {taskId}</div> }));
const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).forEach(f => f()); vi.clearAllMocks(); });
const state: ObservationState = { id: 'observation', status: 'active', revision: 3, analyzedRevision: 3, lastProcessedAt: 1,
  topics: [{ id: 'topic', title: '项目周报', revision: 1, entries: [{ id: 'source', kind: 'user_work', text: '整理周报', createdAt: 1 }],
    feedback: [], trials: [] }] };
function render(observation = state) {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); const updated = vi.fn();
  act(() => root.render(<HomeObservationCard observation={observation} advisor={{ state: 'quiet', reason: 'no_change' }} language="zh" onUpdated={updated} />));
  cleanups.push(() => { act(() => root.unmount()); container.remove(); });
  const button = (text: string) => [...container.querySelectorAll('button')].find(b => b.textContent?.includes(text))!;
  return { container, button, updated };
}
describe('Home observation card', () => {
  it('keeps one-off feedback scoped and retains the input on a stale revision response', async () => {
    const { container, button } = render();
    act(() => button('补充一句').click());
    const input = container.querySelector('textarea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '只在发布期需要');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    fetchJson.mockRejectedValueOnce(new Error('Observation revision changed'));
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    const body = JSON.parse(fetchJson.mock.calls[0][1].body);
    expect(body.command).toEqual({ kind: 'feedback', topicId: 'topic', text: '只在发布期需要', scope: 'once' });
    expect(body.expectedRevision).toBe(3);
    expect(container.querySelector('textarea')?.value).toBe('只在发布期需要');
    expect(container.querySelector('[role=alert]')?.textContent).toContain('revision changed');
  });

  it('requires explicit resume coverage and a separate forget confirmation', async () => {
    fetchJson.mockResolvedValue(state);
    const { container, button } = render({ ...state, status: 'paused' });
    act(() => button('恢复观察').click());
    expect(fetchJson).not.toHaveBeenCalled();
    await act(async () => button('仅看之后的新记录').click());
    expect(JSON.parse(fetchJson.mock.calls[0][1].body).command).toEqual({ kind: 'resume', mode: 'new_only' });
    act(() => button('观察记录').click());
    act(() => button('忘记并排除').click());
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('原始记录、已有任务和自动化保留');
    await act(async () => button('确认忘记').click());
    expect(JSON.parse(fetchJson.mock.calls[1][1].body).command.kind).toBe('forget');
  });

  it('offers an explicit opt-in explaining its coverage', async () => {
    fetchJson.mockResolvedValue(state);
    const { container, button } = render({ status: 'disabled', revision: 0, analyzedRevision: 0, lastProcessedAt: null, topics: [] });
    expect(container.textContent).toContain('不扫描屏幕');
    expect(fetchJson).not.toHaveBeenCalled();
    await act(async () => button('开启观察').click());
    expect(JSON.parse(fetchJson.mock.calls[0][1].body).command).toEqual({ kind: 'start', backfillDays: 30 });
  });
});

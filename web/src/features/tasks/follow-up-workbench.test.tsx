// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { FollowUp, ObservationState } from '@xopcai/gateway-contract';
import { FollowUpWorkbench, FollowUpCard } from './follow-up-workbench';
const fetchJson = vi.hoisted(() => vi.fn());
vi.mock('@/lib/fetch', () => ({ fetchJson }));
vi.mock('./home-task-review', () => ({ HomeTaskReview: ({ taskId }: {
        taskId: string;
    }) => <div>Step review {taskId}</div> }));
const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).forEach(f => f()); vi.clearAllMocks(); });
const goal: FollowUp = { id: 'goal', rootTaskId: 'parent', goal: '查清 connector 重复请求原因', criteria: ['复现条件清楚', '原因有日志证据'], topicIds: ['topic'], status: 'waiting', revision: 3,
    nextStep: '结合新日志检查时间线', waitingFor: '需要两次重复请求的日志', summary: '已整理问题线索，尚未确认原因', autoContinue: true, remainingSteps: 2, stopPending: false,
    steps: [{ number: 1, taskId: 'step-1', action: '整理问题线索', status: 'succeeded', verified: true, summary: '已整理问题线索，尚未确认原因', createdAt: 1 }] };
const observation: ObservationState = { status: 'active', revision: 4, analyzedRevision: 4, lastProcessedAt: 1, topics: [{ id: 'topic', title: '排查请求重复', revision: 1, entries: [], feedback: [], trials: [] }] };
function render(node: React.ReactNode) { const container = document.createElement('div'); document.body.append(container); const root = createRoot(container); act(() => root.render(node)); cleanup.push(() => { act(() => root.unmount()); container.remove(); }); return { container, button: (name: string) => [...container.querySelectorAll('button')].find(b => b.textContent?.includes(name))! }; }
function fill(input: HTMLInputElement | HTMLTextAreaElement, value: string) { act(() => { const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
it('requires a goal, completion criteria and a first step before starting bounded follow-through', async () => {
    fetchJson.mockResolvedValue(goal);
    const { container, button } = render(<FollowUpWorkbench observation={observation} language="zh" onUpdated={vi.fn()}/>);
    act(() => button('交给我持续推进').click());
    expect(fetchJson).not.toHaveBeenCalled();
    const areas = container.querySelectorAll('textarea');
    fill(areas[0], '查清 connector 重复请求原因');
    fill(areas[1], '复现条件清楚\n原因有日志证据');
    fill(container.querySelector<HTMLInputElement>('input:not([type=checkbox])')!, '整理现有线索');
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(fetchJson.mock.calls[0][0]).toContain('/api/home/follow-ups');
    expect(JSON.parse(fetchJson.mock.calls[0][1].body)).toMatchObject({ goal: goal.goal, criteria: goal.criteria, firstStep: '整理现有线索', autoContinue: true, stepBudget: 3, topicIds: ['topic'] });
});
it('shows the stable goal, actual progress, blocker and next step, and attaches updates to it', async () => {
    fetchJson.mockResolvedValue({ ...goal, revision: 4, status: 'working' });
    const { container, button } = render(<FollowUpCard followUp={goal} language="zh" onUpdated={vi.fn()}/>);
    for (const copy of [goal.goal, goal.summary, goal.waitingFor, goal.nextStep])
        expect(container.textContent).toContain(copy);
    fill(container.querySelector('textarea')!, '新增 requestId 相同的两条日志');
    await act(async () => button('补充资料，继续推进').click());
    expect(JSON.parse(fetchJson.mock.calls[0][1].body)).toMatchObject({ expectedRevision: 3, command: { kind: 'add_input', text: '新增 requestId 相同的两条日志' } });
});
it('does not mark a verified step as a completed goal and requires every acceptance criterion', async () => {
    fetchJson.mockResolvedValue({ ...goal, status: 'done', revision: 4 });
    const { container, button } = render(<FollowUpCard followUp={{ ...goal, status: 'review' }} language="zh" onUpdated={vi.fn()}/>);
    expect(container.textContent).not.toContain('已由你验收完成');
    act(() => button('验收整个目标').click());
    expect(button('确认目标已完成').disabled).toBe(true);
    const checks = container.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    act(() => checks.forEach(c => c.click()));
    fill(container.querySelectorAll('textarea')[1], '已核对日志与复现步骤');
    await act(async () => button('确认目标已完成').click());
    expect(JSON.parse(fetchJson.mock.calls[0][1].body).command).toMatchObject({ kind: 'complete', confirmedCriteria: [0, 1] });
});

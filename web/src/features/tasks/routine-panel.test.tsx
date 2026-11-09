// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { Routine } from '@xopcai/gateway-contract';
import { RoutineAdoption, RoutinePanel } from './routine-panel';
const fetchJson = vi.hoisted(() => vi.fn());
vi.mock('@/lib/fetch', () => ({ fetchJson }));
vi.mock('./home-task-review', () => ({ HomeTaskReview: ({ taskId }: {
        taskId: string;
    }) => <div>Review {taskId}</div> }));
const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).forEach(f => f()); vi.clearAllMocks(); });
const routine: Routine = { id: 'routine', topicId: 'topic', title: '项目周报', status: 'active', revision: 4, adoptedVersion: 1, automationId: 'auto',
    validUntil: Date.now() + 86400000, schedule: { kind: 'cron', expr: '30 9 * * 2', tz: 'Asia/Shanghai' }, executions: [],
    methods: [{ version: 2, baseVersion: 1, additions: ['检查未解决阻塞'], status: 'candidate', validationTaskId: null, validation: 'unverified' },
        { version: 1, baseVersion: null, additions: [], status: 'approved', validationTaskId: null, validation: 'unverified' }] };
function render(node: React.ReactNode) {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(node));
    cleanups.push(() => { act(() => root.unmount()); container.remove(); });
    return { container, button: (s: string) => [...container.querySelectorAll('button')].find(b => b.textContent?.includes(s))! };
}
it('requires confirmation of the recurring agreement and sends the reviewed Task version', async () => {
    fetchJson.mockResolvedValue(routine);
    const { container, button } = render(<RoutineAdoption topicId="topic" trial={{ taskId: 'trial', title: 'Trial draft', phase: 'review', resolution: null, taskVersion: 9 }} language="zh" onUpdated={vi.fn()}/>);
    act(() => button('确认长期托管').click());
    expect(fetchJson).not.toHaveBeenCalled();
    expect(container.textContent).toContain('不自动发送或发布');
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(fetchJson.mock.calls[0][0]).toContain('/routines/adopt');
    expect(JSON.parse(fetchJson.mock.calls[0][1].body)).toMatchObject({ topicId: 'topic', trialTaskId: 'trial', expectedTaskVersion: 9, schedule: { kind: 'cron' } });
});
it('shows verification before adoption and keeps scheduling values when editing', async () => {
    const { container, button } = render(<RoutinePanel routine={routine} language="zh" onUpdated={vi.fn()}/>);
    expect(container.textContent).toContain('暂停观察不暂停此项托管');
    expect(container.textContent).toContain('先验证改进');
    expect(container.textContent).not.toContain('后续使用这个改进');
    act(() => button('调整时间').click());
    expect(container.querySelector<HTMLInputElement>('input[type=time]')!.value).toBe('09:30');
    expect([...container.querySelectorAll('[aria-pressed=true]')].some(e => e.textContent === '周二')).toBe(true);
    fetchJson.mockResolvedValue({ ...routine, revision: 5 });
    await act(async () => button('先验证改进').click());
    expect(JSON.parse(fetchJson.mock.calls[0][1].body)).toMatchObject({ expectedRevision: 4, command: { kind: 'validate', version: 2 } });
});
it('offers adoption after a passing validation and requires a separate end confirmation', async () => {
    fetchJson.mockResolvedValue({ ...routine, status: 'ended', revision: 5 });
    const candidate = { ...routine, methods: routine.methods.map(m => m.version === 2 ? { ...m, status: 'validating' as const, validation: 'passed' as const, validationTaskId: 'validation' } : m) };
    const { container, button } = render(<RoutinePanel routine={candidate} language="zh" onUpdated={vi.fn()}/>);
    expect(container.textContent).toContain('后续使用这个改进');
    act(() => button('结束托管').click());
    expect(fetchJson).not.toHaveBeenCalled();
    await act(async () => button('确认结束').click());
    expect(JSON.parse(fetchJson.mock.calls[0][1].body).command).toEqual({ kind: 'end' });
});

// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskInputCard } from '../task-input-card';
import { commandTask, type TaskDetail } from '../home-api';
import type { TaskWait } from '@xopcai/gateway-contract';

vi.mock('../home-api', () => ({ commandTask: vi.fn() }));
vi.mock('@/stores/activity-store', () => ({ showActivity: vi.fn() }));

describe('task input card', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks(); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  it('keeps the answer and idempotency key after failure, then reports the updated task', async () => {
    const onUpdated = vi.fn();
    const detail = { task: { id: 'task', version: 4 }, waits: [] } as unknown as TaskDetail;
    const wait = { id: 'wait', reason: 'Audience?', kind: 'user_input', condition: { choices: ['Designers'] } } as unknown as TaskWait;
    await act(async () => { root.render(<TaskInputCard detail={detail} wait={wait} zh onUpdated={onUpdated} />); });
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    act(() => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Designers')!.click());
    vi.mocked(commandTask).mockRejectedValueOnce(new Error('Network failed')).mockResolvedValueOnce(detail);
    const submit = () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await act(async () => { submit(); });
    expect(container.querySelector('textarea')?.value).toBe('Designers');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(onUpdated).not.toHaveBeenCalled();
    await act(async () => { submit(); });
    expect(onUpdated).toHaveBeenCalledWith(detail);
    expect(vi.mocked(commandTask).mock.calls[0]?.[3]).toBe(vi.mocked(commandTask).mock.calls[1]?.[3]);
    expect(vi.mocked(commandTask).mock.calls[0]?.[1]).toMatchObject({ waitId: 'wait', resolution: { kind: 'user_answer', answer: 'Designers' } });
  });
});

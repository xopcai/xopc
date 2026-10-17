import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { complete } = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock('../../providers/model-call.js', () => ({ completeWithResolvedCredentials: complete }));
vi.mock('../../providers/index.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../providers/index.js')>(),
  resolveModel: (ref: string) => ({ id: ref }),
}));

import { initializeTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { closeXopcDatabase } from '../../storage/sqlite/index.js';
import { decideTaskAllocation, type AllocationDecision } from '../task-allocation-service.js';
import { TaskRepository } from '../task-repository.js';

const response = (decision: AllocationDecision) => ({
  role: 'assistant', stopReason: 'stop',
  content: [{ type: 'text', text: JSON.stringify(decision) }],
});

describe('allocation explanation language', () => {
  beforeEach(() => {
    complete.mockReset();
    initializeTestAgentCatalog({ agents: [
      { id: 'task-router', purpose: 'task_dispatcher', toolAllowlist: [] },
    ] });
  });
  afterEach(() => closeXopcDatabase());

  function allocate(locale: 'zh' | 'en' = 'zh') {
    const task = new TaskRepository().create({
      title: '查找西岸美术馆购票入口', objective: '查找西岸美术馆购票入口', locale,
    });
    return decideTaskAllocation({ task, candidates: [], signal: AbortSignal.timeout(5_000) });
  }

  it.each([
    [{ kind: 'select', agentId: 'researcher', reason: 'The specialist can research official ticketing sources.' },
      { kind: 'select', agentId: 'researcher', reason: '该执行者擅长核对官方购票来源。' }],
    [{ kind: 'no_candidate', reason: 'No eligible specialist has the required research tools.' },
      { kind: 'no_candidate', reason: '没有具备所需检索工具的可用执行者。' }],
    [{ kind: 'needs_input', question: 'Which exhibition and date should the researcher check?' },
      { kind: 'needs_input', question: '需要查询哪个展览和日期？' }],
  ] as [AllocationDecision, AllocationDecision][])('repairs an English $kind explanation once', async (english, chinese) => {
    complete.mockResolvedValueOnce(response(english)).mockResolvedValueOnce(response(chinese));
    await expect(allocate()).resolves.toEqual(chinese);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0][1].messages[0].content).toContain('Simplified Chinese');
    expect(complete.mock.calls[1][1].messages.at(-1).content).toContain(JSON.stringify(english));
  });

  it('accepts Chinese prose with preserved names and URLs without another model call', async () => {
    const decision: AllocationDecision = { kind: 'select', agentId: 'researcher',
      reason: 'Research Assistant 可核对 https://www.wbmshanghai.com 的官方入口。' };
    complete.mockResolvedValue(response(decision));
    await expect(allocate()).resolves.toEqual(decision);
    expect(complete).toHaveBeenCalledOnce();
  });

  it('preserves explicitly requested English even when the objective contains Chinese', async () => {
    const decision: AllocationDecision = { kind: 'select', agentId: 'researcher',
      reason: 'The specialist can research official ticketing sources.' };
    complete.mockResolvedValue(response(decision));
    await expect(allocate('en')).resolves.toEqual(decision);
    expect(complete).toHaveBeenCalledOnce();
  });

  it('stops after two untranslated responses with a Chinese error', async () => {
    complete.mockResolvedValue(response({ kind: 'select', agentId: 'researcher',
      reason: 'The specialist can research official ticketing sources.' }));
    await expect(allocate()).rejects.toThrow('任务分配说明未使用中文，请重试分配。');
    expect(complete).toHaveBeenCalledTimes(2);
  });
});

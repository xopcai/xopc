import { beforeEach, describe, expect, it, vi } from 'vitest';

const { complete } = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock('../../providers/model-call.js', () => ({ completeWithResolvedCredentials: complete }));
vi.mock('../../providers/index.js', () => ({ resolveModel: (ref: string) => ({ id: ref }) }));
vi.mock('../../config/schema.js', () => ({ getAgentDefaultChatModelConfig: () => ({ primary: 'primary', fallbacks: ['backup'] }) }));
import { completeTaskModelCall } from '../task-model-call.js';
import { ModelTaskContractPlanner } from '../task-contract-planner.js';

const success = (text = 'ok') => ({ role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' });
const outage = { role: 'assistant', content: [], stopReason: 'error', errorMessage: '502 provider_error' };
const call = (signal?: AbortSignal) => completeTaskModelCall({ primary: 'primary', fallbacks: ['backup'] },
  { messages: [] }, { signal }, { operation: 'task.research_review' });

describe('task background model recovery', () => {
  beforeEach(() => { complete.mockReset(); });
  it('uses the configured backup after a returned 502 and preserves the caller deadline', async () => {
    const signal = AbortSignal.timeout(1000);
    complete.mockResolvedValueOnce(outage).mockResolvedValueOnce(success());
    await expect(call(signal)).resolves.toMatchObject({ stopReason: 'stop' });
    expect(complete.mock.calls.map(args => args[0].id)).toEqual(['primary', 'backup']);
    expect(complete.mock.calls.every(args => args[2].signal === signal)).toBe(true);
  });
  it('does not switch models for authentication, quota or cancelled requests', async () => {
    for (const message of ['401 Unauthorized', '502 insufficient_quota']) {
      complete.mockReset().mockRejectedValue(new Error(message));
      await expect(call()).rejects.toThrow(message);
      expect(complete).toHaveBeenCalledTimes(1);
    }
    complete.mockReset();
    await expect(call(AbortSignal.abort())).rejects.toThrow();
    expect(complete).not.toHaveBeenCalled();
  });
  it('stops after the configured bounded chain fails', async () => {
    complete.mockResolvedValue(outage);
    await expect(call()).rejects.toThrow('502');
    expect(complete).toHaveBeenCalledTimes(2);
  });
  it('bounds rate-limit recovery to the configured chain and keeps its original deadline', async () => {
    const signal = AbortSignal.timeout(1000);
    complete.mockRejectedValue(new Error('429 rate limit exceeded'));
    await expect(call(signal)).rejects.toThrow('429');
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls.every(args => args[2].signal === signal)).toBe(true);
  });
  it('expands concrete criteria after planner 502 instead of silently retaining the generic contract', async () => {
    complete.mockResolvedValueOnce(outage).mockResolvedValueOnce(success(JSON.stringify({ objective: 'Research',
      requiredCapabilities: ['web_research', 'execute_code', 'publish_files'], expectedOutputs: ['report.md'], acceptanceCriteria: ['report.md cites the actual fetched MDN source', 'CSV totals reconcile with input rows'] })));
    const contract = await new ModelTaskContractPlanner().plan({ objective: 'Research', taskContext: 'Read MDN and reconcile CSV totals' });
    expect(contract.acceptanceCriteria).toEqual(['report.md cites the actual fetched MDN source', 'CSV totals reconcile with input rows']);
    expect(complete.mock.calls.map(args => args[0].id)).toEqual(['primary', 'backup']);
  });  it('repairs nested planner arrays once within the original background deadline', async () => {
    const signal = AbortSignal.timeout(1000);
    complete.mockResolvedValueOnce(success(JSON.stringify({ objective: 'Deliver', expectedOutputs: [{ path: 'report.md' }],
      acceptanceCriteria: [{ criterion: 'Report verified' }], requiredCapabilities: ['publish_files'] })))
      .mockResolvedValueOnce(success(JSON.stringify({ objective: 'Deliver', expectedOutputs: ['report.md'],
        acceptanceCriteria: ['Report verified'], requiredCapabilities: ['publish_files'] })));
    const planned = await new ModelTaskContractPlanner().plan({ objective: 'Deliver', signal });
    expect(planned.capabilityPlanning).toBe('complete');
    expect(planned.requiredCapabilities).toEqual(['publish_files']);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls.every(args => args[2].signal === signal)).toBe(true);
  });
  it('marks operation planning unavailable after both malformed responses', async () => {
    complete.mockResolvedValue(success('{"expectedOutputs":[{"path":"report.md"}]}'));
    expect((await new ModelTaskContractPlanner().plan({ objective: 'Deliver' })).capabilityPlanning).toBe('unavailable');
    expect(complete).toHaveBeenCalledTimes(2);
  });

});

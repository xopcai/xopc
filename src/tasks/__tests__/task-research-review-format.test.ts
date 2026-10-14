import type { TaskResearchResult } from '@xopcai/gateway-contract';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { complete } = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock('../../providers/model-call.js', () => ({ completeWithResolvedCredentials: complete }));
vi.mock('../../providers/index.js', () => ({ resolveModel: () => ({ provider: 'fixture', id: 'fixture' }) }));
vi.mock('../../config/agent-profile.js', () => ({ resolveEffectiveAgentConfigForSession: () => ({ config: { models: { chat: { primary: 'fixture/model' } } } }) }));
import { reviewResearchResult } from '../task-research-result.js';

const result: TaskResearchResult = { version: 1, contractVersion: 1, instructionSequence: 0, review: 'unavailable',
  sources: [{ id: 'source', toolCallId: 'read', toolName: 'read_file', excerpt: 'Price 1/hour', observedAt: 1, snapshotHash: 'a'.repeat(64) }],
  claims: [{ id: 'price', statement: 'Price 1/hour', kind: 'fact', sourceIds: ['source'], support: 'unreviewed' }], checks: [] };
const valid = { claims: [{ id: 'price', support: 'supported', note: 'Matches the quote' }],
  checks: [{ criterionIndex: 0, status: 'passed', claimIds: ['price'], note: 'Matches source' }], instructions: [] };
const response = (text: string) => ({ role: 'assistant', content: [{ type: 'text', text }] });
const review = () => reviewResearchResult({ conversationId: 'fixture', brief: 'Check price', criteria: ['Price'], result });

describe('personal research review format benchmark v1', () => {
  beforeEach(() => complete.mockReset());
  it('J01-prose: retries a non-JSON audit once without worker re-execution', async () => {
    complete.mockResolvedValueOnce(response('The price seems correct.')).mockResolvedValueOnce(response(JSON.stringify(valid)));
    expect((await review()).checks[0].status).toBe('passed'); expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1][1].messages[0].content).toContain('failed structural validation');
  });
  it('J02-invented-index: rejects extra criterion indices before requesting a corrected structure', async () => {
    complete.mockResolvedValueOnce(response(JSON.stringify({ ...valid, checks: [{ ...valid.checks[0], criterionIndex: 1 }] })))
      .mockResolvedValueOnce(response(JSON.stringify(valid)));
    expect((await review()).checks[0].criterionIndex).toBe(0); expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1][1].messages[0].content).toContain('criterion indices: 0..0');
  });
  it('J03-bounded: two invalid structures fail rather than fabricate verification or retry forever', async () => {
    complete.mockResolvedValue(response('{"claims":'));
    await expect(review()).rejects.toThrow(); expect(complete).toHaveBeenCalledTimes(2);
  });
});

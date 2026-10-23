import type { TaskResearchResult } from '@xopcai/gateway-contract';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/agent-profile.js', () => ({ resolveEffectiveAgentConfigForSession: () => ({config:{models:{chat:{primary:'test'}}}}) }));
const complete = vi.hoisted(() => vi.fn());
vi.mock('../task-model-call.js', () => ({ completeTaskModelCall: complete }));
import { reviewResearchResult } from '../task-research-result.js';

describe('research submission host observations', () => {
  it('exposes current source associations without treating submission as factual support', async () => {
    const result: TaskResearchResult = {version:1,contractVersion:1,instructionSequence:0,review:'unavailable',checks:[],
      sources:[{id:'source',toolCallId:'read',toolName:'read_file',excerpt:'Price is 1.',snapshotHash:'a'.repeat(64),observedAt:1000}],
      claims:[{id:'wrong',kind:'fact',statement:'Price is 100.',sourceIds:['source'],support:'supported',note:'Worker assertion'}]};
    complete.mockResolvedValue({content:[{type:'text',text:JSON.stringify({claims:[{id:'wrong',support:'unsupported',note:'The quoted price is 1.'}],checks:[{criterionIndex:0,status:'failed',claimIds:['wrong'],note:'Wrong price.'}],instructions:[]})}]});
    const reviewed = await reviewResearchResult({conversationId:'test',brief:'Price research',criteria:['Submit evidence-linked correct prices'],result});
    const context = complete.mock.calls.at(-1)![1];
    const audit = JSON.parse(context.messages[0].content);
    expect(audit.hostObservations).toMatchObject({submissionReceived:true,sourceQuotesMatched:true,
      claimSourceBindings:[{claimId:'wrong',sourceIds:['source'],allSourcesBound:true}]});
    expect(audit.result.claims[0]).not.toHaveProperty('support');
    expect(audit.result.claims[0]).not.toHaveProperty('note');
    expect(context.systemPrompt).toContain('not-yet-returned publish_task_result receipt');
    expect(reviewed.claims[0].support).toBe('unsupported');
    expect(reviewed.checks[0].status).toBe('failed');
  });
});

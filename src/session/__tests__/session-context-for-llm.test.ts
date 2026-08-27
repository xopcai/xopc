import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { describe, expect, it } from 'vitest';

import {
  buildSessionContextForLlm,
  isTranscriptBashExecutionEntry,
  isTranscriptCompactionEntry,
  isTranscriptContextEntry,
  isTranscriptCustomMessageEntry,
  isTranscriptCustomStateEntry,
  isTranscriptLabelEntry,
  isTranscriptMetadataEntry,
  isTranscriptSummaryMessageEntry,
  mergeLlmMessagesPreservingContextRows,
  transcriptRowsFromJsonArray,
} from '../session-context-for-llm.js';

describe('session-context-for-llm', () => {
  it('buildSessionContextForLlm drops kind: context', () => {
    const u = { role: 'user', content: [{ type: 'text', text: 'x' }] } as AgentMessage;
    const rows = [u, { kind: 'context', text: 'note' } as const];
    expect(buildSessionContextForLlm(rows)).toEqual([u]);
  });

  it('buildSessionContextForLlm keeps completed tool calls without synthesizing user messages', () => {
    const user = { role: 'user', content: [{ type: 'text', text: 'fix tests' }] } as AgentMessage;
    const assistant = {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'plan-1', name: 'update_plan', input: {} },
        { type: 'tool_use', id: 'cmd-1', name: 'exec_command', input: { cmd: 'pnpm test' } },
        { type: 'tool_use', id: 'patch-1', name: 'apply_patch', input: {} },
      ],
    } as unknown as AgentMessage;
    const planResult = {
      role: 'toolResult',
      toolCallId: 'plan-1',
      content: JSON.stringify({
        details: {
          explanation: 'P1',
          plan: [
            { step: 'Implement', status: 'completed' },
            { step: 'Review', status: 'in_progress' },
          ],
        },
      }),
    } as unknown as AgentMessage;
    const commandResult = {
      role: 'toolResult',
      toolCallId: 'cmd-1',
      content: JSON.stringify({
        details: {
          command: 'pnpm test',
          status: 'failed',
          exitCode: 1,
          failureHint: 'Inspect stderr first',
        },
      }),
    } as unknown as AgentMessage;
    const patchResult = {
      role: 'toolResult',
      toolCallId: 'patch-1',
      content: JSON.stringify({
        details: {
          files: ['src/a.ts'],
          added: 2,
          removed: 1,
          summary: 'update: src/a.ts (+2/-1)',
        },
      }),
    } as unknown as AgentMessage;

    const messages = buildSessionContextForLlm([user, assistant, planResult, commandResult, patchResult]);

    expect(messages).toEqual([user, assistant, planResult, commandResult, patchResult]);
    expect(JSON.stringify(messages)).not.toContain('<coding_context>');
  });

  it('buildSessionContextForLlm removes orphaned calls and results', () => {
    const assistant = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'working' },
        { type: 'tool_use', id: 'cmd-1', name: 'exec_command', input: { cmd: 'pnpm test' } },
        { type: 'tool_use', id: 'orphan-call', name: 'apply_patch', input: {} },
      ],
    } as unknown as AgentMessage;
    const commandResult = {
      role: 'toolResult',
      toolCallId: 'cmd-1',
      content: 'Command exited with code 1',
    } as unknown as AgentMessage;
    const orphanResult = {
      role: 'toolResult',
      toolCallId: 'orphan-result',
      content: 'stale result',
    } as unknown as AgentMessage;

    const messages = buildSessionContextForLlm([orphanResult, assistant, commandResult]);
    const text = JSON.stringify(messages);

    expect(messages).toHaveLength(2);
    expect(text).toContain('cmd-1');
    expect(text).toContain('working');
    expect(text).not.toContain('orphan-call');
    expect(text).not.toContain('orphan-result');
    expect(text).not.toContain('stale result');
  });

  it('buildSessionContextForLlm maps included bash execution rows into user context', () => {
    const u = { role: 'user', content: [{ type: 'text', text: 'x' }] } as AgentMessage;
    const bash = { role: 'bashExecution', command: 'pwd', output: '/repo\n', exitCode: 0 } as const;
    const messages = buildSessionContextForLlm([u, bash]);
    expect(messages[0]).toEqual(u);
    expect(messages[1]?.role).toBe('user');
    expect(JSON.stringify(messages[1]?.content)).toContain('<local_shell>');
    expect(JSON.stringify(messages[1]?.content)).toContain('$ pwd');
    expect(JSON.stringify(messages[1]?.content)).toContain('/repo');
  });

  it('buildSessionContextForLlm drops excluded bash execution audit rows', () => {
    const u = { role: 'user', content: [{ type: 'text', text: 'x' }] } as AgentMessage;
    const bash = {
      role: 'bashExecution',
      command: 'pwd',
      output: '/repo\n',
      exitCode: 0,
      excludeFromContext: true,
    } as const;
    expect(buildSessionContextForLlm([u, bash])).toEqual([u]);
  });

  it('buildSessionContextForLlm maps custom message rows into user context', () => {
    const u = { role: 'user', content: [{ type: 'text', text: 'x' }] } as AgentMessage;
    const custom = { role: 'custom', customType: 'demo', content: 'note', display: true } as const;
    expect(buildSessionContextForLlm([u, custom])).toEqual([
      u,
      { role: 'user', content: [{ type: 'text', text: 'note' }] },
    ]);
  });

  it('buildSessionContextForLlm drops summary audit rows', () => {
    const u = { role: 'user', content: [{ type: 'text', text: 'x' }] } as AgentMessage;
    const branch = { role: 'branchSummary', summary: 'branch note', fromId: 'entry-1' } as const;
    const compaction = { role: 'compactionSummary', summary: 'compact note', tokensBefore: 1000 } as const;
    expect(buildSessionContextForLlm([u, branch, compaction])).toEqual([u]);
  });

  it('buildSessionContextForLlm uses the latest append-only compaction boundary', () => {
    const oldUser = { role: 'user', content: 'old user detail' } as AgentMessage;
    const oldAssistant = { role: 'assistant', content: 'old answer' } as AgentMessage;
    const summary = {
      role: 'user',
      content: '<conversation_summary>durable old context</conversation_summary>',
    } as AgentMessage;
    const kept = { role: 'assistant', content: 'recent answer' } as AgentMessage;
    const newer = { role: 'user', content: 'new question' } as AgentMessage;

    expect(buildSessionContextForLlm([
      oldUser,
      oldAssistant,
      {
        type: 'compaction',
        at: '2026-08-05T00:00:00.000Z',
        baseSeq: 2,
        plannerVersion: 3,
        summaryModelRef: 'test/model',
        qualityAudit: 'passed',
        handover: { version: 1, sourceThroughSeq: 2, items: [] },
        audit: { status: 'passed', mode: 'structural', missingItemsFound: 0, repaired: false },
        summary: 'durable old context',
        messages: [summary, kept],
        firstKeptIndex: 1,
        tokensBefore: 1000,
        tokensAfter: 100,
      },
      newer,
    ])).toEqual([summary, kept, newer]);
  });

  it('buildSessionContextForLlm replaces an earlier compaction boundary on repeated compaction', () => {
    const firstSummary = { role: 'user', content: 'summary one' } as AgentMessage;
    const secondSummary = { role: 'user', content: 'summary two' } as AgentMessage;
    const recent = { role: 'user', content: 'recent' } as AgentMessage;

    expect(buildSessionContextForLlm([
      { role: 'user', content: 'original' } as AgentMessage,
      {
        type: 'compaction',
        at: '2026-08-05T00:00:00.000Z',
        baseSeq: 1,
        plannerVersion: 3,
        summaryModelRef: 'test/model',
        qualityAudit: 'passed',
        handover: { version: 1, sourceThroughSeq: 1, items: [] },
        audit: { status: 'passed', mode: 'structural', missingItemsFound: 0, repaired: false },
        summary: 'one',
        messages: [firstSummary],
        firstKeptIndex: 1,
        tokensBefore: 100,
        tokensAfter: 20,
      },
      { role: 'assistant', content: 'between' } as AgentMessage,
      {
        type: 'compaction',
        at: '2026-08-05T01:00:00.000Z',
        baseSeq: 3,
        plannerVersion: 3,
        summaryModelRef: 'test/model',
        qualityAudit: 'passed',
        handover: { version: 1, sourceThroughSeq: 3, items: [] },
        audit: { status: 'passed', mode: 'structural', missingItemsFound: 0, repaired: false },
        summary: 'two',
        messages: [secondSummary],
        firstKeptIndex: 2,
        tokensBefore: 120,
        tokensAfter: 25,
      },
      recent,
    ])).toEqual([secondSummary, recent]);
  });

  it('buildSessionContextForLlm drops label audit rows', () => {
    const u = { role: 'user', content: [{ type: 'text', text: 'x' }] } as AgentMessage;
    const label = { type: 'label', targetId: 'u1', label: 'important' } as const;
    expect(buildSessionContextForLlm([u, label])).toEqual([u]);
  });

  it('buildSessionContextForLlm drops metadata rows', () => {
    const u = { role: 'user', content: [{ type: 'text', text: 'x' }] } as AgentMessage;
    const model = { type: 'model_change', provider: 'openai', modelId: 'gpt-5' } as const;
    const thinking = { type: 'thinking_level_change', thinkingLevel: 'high' } as const;
    const info = { type: 'session_info', name: 'Demo' } as const;
    expect(buildSessionContextForLlm([u, model, thinking, info])).toEqual([u]);
  });

  it('isTranscriptContextEntry', () => {
    expect(isTranscriptContextEntry({ kind: 'context' })).toBe(true);
    expect(isTranscriptContextEntry({ role: 'user', content: 'a' })).toBe(false);
  });

  it('isTranscriptBashExecutionEntry', () => {
    expect(isTranscriptBashExecutionEntry({ role: 'bashExecution', command: 'pwd' })).toBe(true);
    expect(isTranscriptBashExecutionEntry({ role: 'user', content: 'pwd' })).toBe(false);
  });

  it('isTranscriptCustomMessageEntry', () => {
    expect(isTranscriptCustomMessageEntry({ role: 'custom', customType: 'demo' })).toBe(true);
    expect(isTranscriptCustomMessageEntry({ type: 'custom_message', customType: 'demo' })).toBe(true);
    expect(isTranscriptCustomMessageEntry({ type: 'custom', customType: 'demo' })).toBe(false);
  });

  it('isTranscriptCustomStateEntry', () => {
    expect(isTranscriptCustomStateEntry({ type: 'custom', customType: 'demo', data: { ok: true } })).toBe(true);
    expect(isTranscriptCustomStateEntry({ type: 'custom_message', customType: 'demo' })).toBe(false);
  });

  it('isTranscriptSummaryMessageEntry', () => {
    expect(isTranscriptSummaryMessageEntry({ role: 'branchSummary', summary: 'branch' })).toBe(true);
    expect(isTranscriptSummaryMessageEntry({ role: 'compactionSummary', summary: 'compact' })).toBe(true);
    expect(isTranscriptSummaryMessageEntry({ role: 'custom', customType: 'demo' })).toBe(false);
  });

  it('isTranscriptCompactionEntry requires a complete context snapshot', () => {
    expect(isTranscriptCompactionEntry({
      type: 'compaction',
      at: '2026-08-05T00:00:00.000Z',
      baseSeq: 10,
      plannerVersion: 3,
      summaryModelRef: 'test/model',
      qualityAudit: 'passed',
      handover: { version: 1, sourceThroughSeq: 10, items: [] },
      audit: { status: 'passed', mode: 'structural', missingItemsFound: 0, repaired: false },
      summary: 'x',
      messages: [],
      firstKeptIndex: 1,
      tokensBefore: 100,
      tokensAfter: 10,
    })).toBe(true);
    expect(isTranscriptCompactionEntry({
      type: 'compaction',
      at: '2026-08-05T00:00:00.000Z',
      summary: 'legacy snapshot',
      messages: [],
      firstKeptIndex: 1,
      tokensBefore: 100,
      tokensAfter: 10,
    })).toBe(false);
    expect(isTranscriptCompactionEntry({ type: 'compaction', summary: 'x' })).toBe(false);
  });

  it('isTranscriptLabelEntry', () => {
    expect(isTranscriptLabelEntry({ type: 'label', targetId: 'u1', label: 'important' })).toBe(true);
    expect(isTranscriptLabelEntry({ role: 'label', targetId: 'u1' })).toBe(false);
  });

  it('isTranscriptMetadataEntry', () => {
    expect(isTranscriptMetadataEntry({ type: 'model_change', modelId: 'gpt-5' })).toBe(true);
    expect(isTranscriptMetadataEntry({ type: 'thinking_level_change', thinkingLevel: 'high' })).toBe(true);
    expect(isTranscriptMetadataEntry({ type: 'session_info', name: 'Demo' })).toBe(true);
    expect(isTranscriptMetadataEntry({ type: 'label', label: 'Demo' })).toBe(false);
  });

  it('mergeLlmMessagesPreservingContextRows keeps context slots in order', () => {
    const u = { role: 'user', content: [{ type: 'text', text: 'u' }] } as AgentMessage;
    const a = { role: 'assistant', content: [{ type: 'text', text: 'a' }] } as AgentMessage;
    const prev = [
      u,
      { kind: 'context', text: 'between' } as const,
      a,
    ];
    const u2 = { role: 'user', content: [{ type: 'text', text: 'u2' }] } as AgentMessage;
    const a2 = { role: 'assistant', content: [{ type: 'text', text: 'a2' }] } as AgentMessage;
    const merged = mergeLlmMessagesPreservingContextRows(prev, [u2, a2]);
    expect(merged).toEqual([u2, { kind: 'context', text: 'between' }, a2]);
  });

  it('mergeLlmMessagesPreservingContextRows keeps bash execution slots in order', () => {
    const u = { role: 'user', content: [{ type: 'text', text: 'u' }] } as AgentMessage;
    const a = { role: 'assistant', content: [{ type: 'text', text: 'a' }] } as AgentMessage;
    const bash = { role: 'bashExecution', command: 'pwd', output: '/repo\n', exitCode: 0 } as const;
    const u2 = { role: 'user', content: [{ type: 'text', text: 'u2' }] } as AgentMessage;
    const a2 = { role: 'assistant', content: [{ type: 'text', text: 'a2' }] } as AgentMessage;

    const merged = mergeLlmMessagesPreservingContextRows([u, bash, a], [u2, a2]);

    expect(merged).toEqual([u2, bash, a2]);
  });

  it('mergeLlmMessagesPreservingContextRows keeps custom message slots in order', () => {
    const u = { role: 'user', content: [{ type: 'text', text: 'u' }] } as AgentMessage;
    const a = { role: 'assistant', content: [{ type: 'text', text: 'a' }] } as AgentMessage;
    const custom = { role: 'custom', customType: 'demo', content: 'note', display: true } as const;
    const u2 = { role: 'user', content: [{ type: 'text', text: 'u2' }] } as AgentMessage;
    const a2 = { role: 'assistant', content: [{ type: 'text', text: 'a2' }] } as AgentMessage;

    const merged = mergeLlmMessagesPreservingContextRows([u, custom, a], [u2, a2]);

    expect(merged).toEqual([u2, custom, a2]);
  });

  it('mergeLlmMessagesPreservingContextRows keeps summary slots in order', () => {
    const u = { role: 'user', content: [{ type: 'text', text: 'u' }] } as AgentMessage;
    const a = { role: 'assistant', content: [{ type: 'text', text: 'a' }] } as AgentMessage;
    const branch = { role: 'branchSummary', summary: 'branch note', fromId: 'entry-1' } as const;
    const compaction = { role: 'compactionSummary', summary: 'compact note', tokensBefore: 1000 } as const;
    const u2 = { role: 'user', content: [{ type: 'text', text: 'u2' }] } as AgentMessage;
    const a2 = { role: 'assistant', content: [{ type: 'text', text: 'a2' }] } as AgentMessage;

    const merged = mergeLlmMessagesPreservingContextRows([u, branch, compaction, a], [u2, a2]);

    expect(merged).toEqual([u2, branch, compaction, a2]);
  });

  it('mergeLlmMessagesPreservingContextRows keeps label slots in order', () => {
    const u = { role: 'user', content: [{ type: 'text', text: 'u' }] } as AgentMessage;
    const a = { role: 'assistant', content: [{ type: 'text', text: 'a' }] } as AgentMessage;
    const label = { type: 'label', targetId: 'u1', label: 'important' } as const;
    const u2 = { role: 'user', content: [{ type: 'text', text: 'u2' }] } as AgentMessage;
    const a2 = { role: 'assistant', content: [{ type: 'text', text: 'a2' }] } as AgentMessage;

    const merged = mergeLlmMessagesPreservingContextRows([u, label, a], [u2, a2]);

    expect(merged).toEqual([u2, label, a2]);
  });

  it('mergeLlmMessagesPreservingContextRows keeps metadata slots in order', () => {
    const u = { role: 'user', content: [{ type: 'text', text: 'u' }] } as AgentMessage;
    const a = { role: 'assistant', content: [{ type: 'text', text: 'a' }] } as AgentMessage;
    const model = { type: 'model_change', provider: 'openai', modelId: 'gpt-5' } as const;
    const thinking = { type: 'thinking_level_change', thinkingLevel: 'high' } as const;
    const info = { type: 'session_info', name: 'Demo' } as const;
    const u2 = { role: 'user', content: [{ type: 'text', text: 'u2' }] } as AgentMessage;
    const a2 = { role: 'assistant', content: [{ type: 'text', text: 'a2' }] } as AgentMessage;

    const merged = mergeLlmMessagesPreservingContextRows([u, model, thinking, info, a], [u2, a2]);

    expect(merged).toEqual([u2, model, thinking, info, a2]);
  });

  it('transcriptRowsFromJsonArray accepts mixed rows', () => {
    const rows = transcriptRowsFromJsonArray([
      { role: 'user', content: 'h' },
      { kind: 'context', text: 't' },
      { role: 'bashExecution', command: 'pwd', output: '/repo\n' },
      { role: 'custom', customType: 'demo', content: 'note', display: true },
      { type: 'custom', customType: 'state', data: { enabled: true } },
      { role: 'branchSummary', summary: 'branch note', fromId: 'entry-1' },
      { role: 'compactionSummary', summary: 'compact note', tokensBefore: 1000 },
      {
        type: 'compaction',
        at: '2026-08-05T00:00:00.000Z',
        baseSeq: 7,
        plannerVersion: 3,
        summaryModelRef: 'test/model',
        qualityAudit: 'passed',
        handover: { version: 1, sourceThroughSeq: 7, items: [] },
        audit: { status: 'passed', mode: 'structural', missingItemsFound: 0, repaired: false },
        summary: 'durable summary',
        messages: [],
        firstKeptIndex: 1,
        tokensBefore: 100,
        tokensAfter: 10,
      },
      { type: 'label', targetId: 'row-a', label: 'important' },
      { type: 'model_change', provider: 'openai', modelId: 'gpt-5' },
      { type: 'thinking_level_change', thinkingLevel: 'high' },
      { type: 'session_info', name: 'Demo' },
      { foo: 'skip' },
    ] as unknown[]);
    expect(rows).toHaveLength(12);
  });
});

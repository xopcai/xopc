import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { describe, expect, it } from 'vitest';

import {
  buildSessionContextForLlm,
  isTranscriptBashExecutionEntry,
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

  it('buildSessionContextForLlm drops bash execution audit rows', () => {
    const u = { role: 'user', content: [{ type: 'text', text: 'x' }] } as AgentMessage;
    const bash = { role: 'bashExecution', command: 'pwd', output: '/repo\n', exitCode: 0 } as const;
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
      { type: 'label', targetId: 'row-a', label: 'important' },
      { type: 'model_change', provider: 'openai', modelId: 'gpt-5' },
      { type: 'thinking_level_change', thinkingLevel: 'high' },
      { type: 'session_info', name: 'Demo' },
      { foo: 'skip' },
    ] as unknown[]);
    expect(rows).toHaveLength(11);
  });
});

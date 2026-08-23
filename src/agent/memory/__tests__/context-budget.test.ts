import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { describe, expect, it } from 'vitest';

import { evaluateContextBudget, pruneToolResultsToFit } from '../context-budget.js';

function toolResult(text: string): AgentMessage {
  return {
    role: 'toolResult',
    toolCallId: 'call-1',
    toolName: 'read_file',
    content: [{ type: 'text', text }],
    isError: false,
    timestamp: Date.now(),
  } as AgentMessage;
}

function toolResultText(message: AgentMessage): string {
  const content = (message as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((block) => block.text ?? '').join('');
}

describe('context budget', () => {
  it('includes system prompt, current user input, and tool schemas in preflight pressure', () => {
    const messages = [{ role: 'user', content: 'x'.repeat(2_400), timestamp: 1 }] as AgentMessage[];
    const evaluation = evaluateContextBudget({
      messages,
      contextWindow: 2_000,
      systemPrompt: 's'.repeat(1_200),
      currentUserMessage: { role: 'user', content: 'u'.repeat(800), timestamp: 2 } as AgentMessage,
      tools: [{ name: 'large_tool', description: 'd'.repeat(800), parameters: { type: 'object' } } as never],
    });

    expect(evaluation.transcriptTokens).toBeGreaterThan(0);
    expect(evaluation.systemPromptTokens).toBeGreaterThan(0);
    expect(evaluation.currentUserTokens).toBeGreaterThan(0);
    expect(evaluation.toolSchemaTokens).toBeGreaterThan(0);
    expect(evaluation.route).not.toBe('fits');
  });

  it('prunes oldest tool results only in the provider projection', () => {
    const original = toolResult('z'.repeat(12_000));
    const result = pruneToolResultsToFit({
      messages: [original],
      contextWindow: 2_500,
      reserveTokens: 1_024,
      canCompact: false,
      minToolResultKeepChars: 500,
    });

    expect(result.prunedToolResults).toBe(1);
    expect(JSON.stringify(result.messages[0])).toContain('truncated');
    expect(JSON.stringify(original)).not.toContain('truncated');
    expect(result.evaluation.estimatedTokens).toBeLessThanOrEqual(result.evaluation.hardLimitTokens);
  });

  it('freezes a pruned tool result at one stable size as pressure increases', () => {
    const oldResult = toolResult('a'.repeat(12_000));
    const recentResult = {
      ...toolResult('b'.repeat(12_000)),
      toolCallId: 'call-2',
    } as AgentMessage;
    const lowerPressure = pruneToolResultsToFit({
      messages: [oldResult, recentResult],
      contextWindow: 5_000,
      reserveTokens: 1_024,
      canCompact: false,
      minToolResultKeepChars: 500,
    });
    const higherPressure = pruneToolResultsToFit({
      messages: [oldResult, recentResult],
      contextWindow: 3_000,
      reserveTokens: 1_024,
      canCompact: false,
      minToolResultKeepChars: 500,
    });

    expect(toolResultText(lowerPressure.messages[0]!))
      .toBe(toolResultText(higherPressure.messages[0]!));
    expect(lowerPressure.prunedToolResults).toBe(1);
    expect(higherPressure.prunedToolResults).toBe(2);
  });
});

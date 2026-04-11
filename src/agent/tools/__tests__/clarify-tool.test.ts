import { describe, it, expect, vi } from 'vitest';
import { createClarifyTool } from '../clarify-tool.js';

describe('clarify tool', () => {
  it('returns unavailable message when resolveAskUser is null and no default', async () => {
    const tool = createClarifyTool({
      resolveAskUser: () => null,
    });
    const r = await tool.execute('1', { question: 'Which one?' });
    expect(r.details?.answer).toBe('');
    expect((r.content[0] as { text: string }).text).toContain('not available');
  });

  it('uses default when resolveAskUser is null but default is set', async () => {
    const tool = createClarifyTool({
      resolveAskUser: () => null,
    });
    const r = await tool.execute('2', { question: 'Which?', default: 'A' });
    expect(r.details?.answer).toBe('A');
  });

  it('calls askUser and returns answer', async () => {
    const ask = vi.fn().mockResolvedValue('blue');
    const tool = createClarifyTool({
      resolveAskUser: () => ask,
    });
    const r = await tool.execute('3', { question: 'Color?' });
    expect(ask).toHaveBeenCalledWith({ question: 'Color?', choices: undefined, default: undefined });
    expect(r.details?.answer).toBe('blue');
  });

  it('uses default on timeout message', async () => {
    const ask = vi.fn().mockRejectedValue(new Error('Clarification timeout: user did not respond within 5 minutes'));
    const tool = createClarifyTool({
      resolveAskUser: () => ask,
    });
    const r = await tool.execute('4', { question: 'x', default: 'fallback' });
    expect(r.details?.answer).toBe('fallback');
  });
});

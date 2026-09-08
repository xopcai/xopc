import { describe, it, expect, vi } from 'vitest';
import { createClarifyTool } from '../clarify-tool.js';

describe('clarify tool', () => {
  it('returns unavailable without silently using a recommendation', async () => {
    const tool = createClarifyTool({
      resolveAskUser: () => null,
    });
    const r = await tool.execute('1', { question: 'Which one?' });
    expect(r.details?.answer).toBe('');
    expect((r.content[0] as { text: string }).text).toContain('not available');
  });

  it('calls askUser and returns answer', async () => {
    const ask = vi.fn().mockResolvedValue({ status: 'answered', answer: 'blue' });
    const tool = createClarifyTool({
      resolveAskUser: () => ask,
    });
    const r = await tool.execute('3', { question: 'Color?' });
    expect(ask).toHaveBeenCalledWith({ question: 'Color?', choices: undefined, suggestedAnswer: undefined });
    expect(r.details?.answer).toBe('blue');
  });

  it('returns a durable waiting result without choosing the recommendation', async () => {
    const ask = vi.fn().mockResolvedValue({ status: 'waiting', waitId: 'wait-1' });
    const tool = createClarifyTool({
      resolveAskUser: () => ask,
    });
    const r = await tool.execute('4', { question: 'x', suggestedAnswer: 'fallback' });
    expect(r.details).toMatchObject({ answer: '', waitId: 'wait-1', status: 'waiting' });
  });
});

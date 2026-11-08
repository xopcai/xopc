import { describe, expect, it, vi } from 'vitest';

import { createTuiSideChat } from '../tui-side-chat.js';

describe('ephemeral terminal side chat', () => {
  it('discards an answer from an earlier visit to the same conversation', async () => {
    let finish!: (value: { text: string }) => void;
    let version = 0;
    const show = vi.fn();
    const run = createTuiSideChat({ client: { sideQuery: () => new Promise(resolve => { finish = resolve; }) },
      conversationId: () => 'A', sessionVersion: () => version, input: vi.fn(), notice: vi.fn(), show });
    const pending = run('question');
    version += 2;
    finish({ text: 'old answer' });
    await pending;
    expect(show).not.toHaveBeenCalled();
  });
  it('keeps follow-up context outside the main transcript', async () => {
    const query = vi.fn(async () => ({ text: 'side answer' }));
    let followUp: (() => void) | undefined;
    const run = createTuiSideChat({ client: { sideQuery: query }, conversationId: () => 'A',
      input: vi.fn(async () => 'follow-up'), notice: vi.fn(), show: (_answer, next) => { followUp = next; } });
    await run('first question');
    followUp!();
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    expect(query.mock.calls[1]![1]).toContain('first question');
    expect(query.mock.calls[1]![1]).toContain('side answer');
    expect(query.mock.calls[1]![1]).toContain('follow-up');
  });

  it('does not show a late answer after switching the main conversation', async () => {
    let finish!: (value: { text: string }) => void;
    let conversationId = 'A';
    const show = vi.fn();
    const run = createTuiSideChat({ client: { sideQuery: () => new Promise(resolve => { finish = resolve; }) },
      conversationId: () => conversationId, input: vi.fn(), notice: vi.fn(), show });
    const pending = run('question');
    conversationId = 'B';
    finish({ text: 'old answer' });
    await pending;
    expect(show).not.toHaveBeenCalled();
  });
});

it('streams side text and cancels without opening a final answer', async () => {
  let cancel!: () => void;
  let read!: () => string;
  const show = vi.fn();
  const query = vi.fn(async (_id: string, _question: string, options?: { signal?: AbortSignal; onDelta?: (text: string) => void }) => {
    options?.onDelta?.('partial side text');
    return new Promise<{ text: string }>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  });
  const run = createTuiSideChat({ client: { sideQuery: query }, conversationId: () => 'A', input: vi.fn(), notice: vi.fn(), show,
    stream: (getText, stop) => { read = getText; cancel = stop; } });
  const pending = run('question');
  expect(read()).toContain('partial side text');
  cancel(); await pending;
  expect(show).not.toHaveBeenCalled();
});

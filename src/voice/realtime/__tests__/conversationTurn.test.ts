import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConversationTurn, needsContinuation } from '../conversationTurn.js';

describe('conversation turn endpoint', () => {
  afterEach(() => vi.useRealTimers());

  function setup(silenceMs = 700) {
    vi.useFakeTimers();
    const ready = vi.fn();
    return { ready, turn: new ConversationTurn(silenceMs, ready) };
  }

  it('does not equate an ASR final with the end of the user turn', () => {
    const { turn, ready } = setup();
    turn.final('first', '今天上海天气怎么样？');
    vi.advanceTimersByTime(499);
    expect(ready).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(ready).toHaveBeenCalledExactlyOnceWith('今天上海天气怎么样？');
  });

  it('merges slow Chinese speech across multiple provider endpoints', () => {
    const { turn, ready } = setup();
    turn.final('first', '帮我查一下。');
    vi.advanceTimersByTime(1000);
    expect(ready).not.toHaveBeenCalled();
    turn.start('second');
    vi.advanceTimersByTime(3000);
    expect(ready).not.toHaveBeenCalled();
    turn.final('second', '明天下午去上海的高铁。');
    vi.advanceTimersByTime(500);
    expect(ready).toHaveBeenCalledExactlyOnceWith('帮我查一下。 明天下午去上海的高铁。');
  });

  it('never releases an old final while the next utterance is still being spoken', () => {
    const { turn, ready } = setup();
    turn.start('first');
    turn.stop('first');
    turn.start('second');
    turn.final('first', '明天下午');
    vi.advanceTimersByTime(5000);
    expect(ready).not.toHaveBeenCalled();
    turn.stop('second');
    vi.advanceTimersByTime(1000);
    expect(ready).not.toHaveBeenCalled();
    turn.final('second', '去上海');
    vi.advanceTimersByTime(350);
    expect(ready).toHaveBeenCalledExactlyOnceWith('明天下午 去上海');
  });

  it('orders delayed transcripts by speech start and waits for every final', () => {
    const { turn, ready } = setup();
    turn.start('first'); turn.stop('first');
    turn.start('second'); turn.stop('second');
    turn.final('second', '去上海');
    vi.advanceTimersByTime(3000);
    expect(ready).not.toHaveBeenCalled();
    turn.final('first', '明天');
    vi.advanceTimersByTime(350);
    expect(ready).toHaveBeenCalledExactlyOnceWith('明天 去上海');
  });

  it('has a bounded wait for incomplete phrases but never times out active speech', () => {
    const { turn, ready } = setup(1200);
    turn.final('first', '因为');
    vi.advanceTimersByTime(1799);
    expect(ready).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(ready).toHaveBeenCalledOnce();
    turn.start('second');
    vi.advanceTimersByTime(10_000);
    expect(ready).toHaveBeenCalledOnce();
  });

  it('clears pending output on reset and safely resolves empty speech', () => {
    const { turn, ready } = setup();
    turn.final('first', '不要发送');
    turn.reset();
    vi.advanceTimersByTime(5000);
    expect(ready).not.toHaveBeenCalled();
    turn.start('noise'); turn.stop('noise'); turn.final('noise', '');
    turn.final('next', '你好');
    vi.advanceTimersByTime(500);
    expect(ready).toHaveBeenCalledExactlyOnceWith('你好');
  });

  it('does not suspend a pending endpoint for duplicate speech-start events', () => {
    const { turn, ready } = setup();
    turn.start('first'); turn.final('first', '你好');
    vi.advanceTimersByTime(100);
    turn.start('first');
    vi.advanceTimersByTime(400);
    expect(ready).toHaveBeenCalledExactlyOnceWith('你好');
  });

  it('restores a queued turn when speech resumes before generation starts', () => {
    const { turn, ready } = setup();
    turn.restore('明天');
    turn.start('more');
    turn.final('more', '去上海');
    vi.advanceTimersByTime(500);
    expect(ready).toHaveBeenCalledExactlyOnceWith('明天 去上海');
  });

  it('bounds transcript buffering instead of accumulating indefinitely', () => {
    const { turn, ready } = setup();
    expect(() => turn.final('long', 'a'.repeat(32_001))).toThrow('limit');
    vi.advanceTimersByTime(5000);
    expect(ready).not.toHaveBeenCalled();
  });

  it.each(['我想……', '帮我查一下。', '因为，', '然后', 'Could you?', 'I would like to...', 'because'])('holds an incomplete phrase: %s', (text) => {
    expect(needsContinuation(text)).toBe(true);
  });

  it.each(['今天天气怎么样？', '我要去上海。', '好的', '嗯，请继续', 'Hello.', 'What is the weather?'])('does not add the long hold to a complete phrase: %s', (text) => {
    expect(needsContinuation(text)).toBe(false);
  });
});

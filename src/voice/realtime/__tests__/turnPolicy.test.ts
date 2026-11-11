import { afterEach, describe, expect, it, vi } from 'vitest';

import { TurnCoordinator, hasContinuationHint, type TurnPolicy } from '../turnPolicy.js';

describe('TurnCoordinator', () => {
  afterEach(() => vi.useRealTimers());

  function setup(policy?: TurnPolicy) {
    vi.useFakeTimers();
    const commit = vi.fn();
    return { commit, turn: new TurnCoordinator(commit, policy) };
  }

  it('waits beyond an ASR final before committing a complete turn', () => {
    const { turn, commit } = setup();
    turn.final('first', '今天上海天气怎么样？');
    vi.advanceTimersByTime(39);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledWith('今天上海天气怎么样？', expect.objectContaining({ disposition: 'complete' }), 'first');
  });

  it('merges utterances in speech-start order and waits for every final', () => {
    const { turn, commit } = setup();
    turn.start('first'); turn.stop('first');
    turn.start('second'); turn.stop('second');
    turn.final('second', '去上海');
    vi.advanceTimersByTime(3_000);
    expect(commit).not.toHaveBeenCalled();
    turn.final('first', '明天');
    vi.advanceTimersByTime(500);
    expect(commit).toHaveBeenCalledWith('明天 去上海', expect.anything(), 'first');
  });

  it('holds incomplete phrases for a bounded interval', () => {
    const { turn, commit } = setup();
    turn.final('first', '因为');
    vi.advanceTimersByTime(1_799);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledOnce();
  });

  it('keeps a request together when streaming recognition finalizes its introduction first', () => {
    const { turn, commit } = setup();
    turn.final('first', '请告诉我。');
    vi.advanceTimersByTime(700);
    expect(commit).not.toHaveBeenCalled();
    turn.start('second');
    turn.final('second', '一加一等于几？');
    vi.advanceTimersByTime(40);
    expect(commit).toHaveBeenCalledExactlyOnceWith('请告诉我。 一加一等于几？', expect.anything(), 'first');
  });

  it('invalidates a pending asynchronous decision when speech resumes', async () => {
    let resolve!: (value: Awaited<ReturnType<TurnPolicy['decide']>>) => void;
    const policy: TurnPolicy = { decide: () => new Promise(done => { resolve = done; }) };
    const { turn, commit } = setup(policy);
    turn.final('first', '明天');
    turn.start('second');
    resolve({ disposition: 'complete', confidence: 1, holdMs: 0, source: 'semantic' });
    await Promise.resolve();
    vi.advanceTimersByTime(5_000);
    expect(commit).not.toHaveBeenCalled();
  });

  it('falls back to the heuristic policy when a policy fails', async () => {
    const { turn, commit } = setup({ decide: async () => { throw new Error('unavailable'); } });
    turn.final('first', '你好');
    await vi.advanceTimersByTimeAsync(500);
    expect(commit).toHaveBeenCalledWith('你好', expect.objectContaining({ source: 'heuristic' }), 'first');
  });

  it('falls back when a semantic policy does not settle', async () => {
    const { turn, commit } = setup({ decide: () => new Promise(() => {}) });
    turn.final('first', '你好');
    await vi.advanceTimersByTimeAsync(749);
    expect(commit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(commit).toHaveBeenCalledWith('你好', expect.objectContaining({ source: 'heuristic' }), 'first');
  });

  it('suppresses backchannels and restores a queued turn without changing its id', () => {
    const backchannel: TurnPolicy = { decide: () => ({ disposition: 'backchannel', confidence: 1, holdMs: 0, source: 'semantic' }) };
    const first = setup(backchannel);
    first.turn.final('ack', '嗯');
    vi.advanceTimersByTime(500);
    expect(first.commit).not.toHaveBeenCalled();

    const second = setup();
    second.turn.restore('original', '明天');
    second.turn.start('more');
    second.turn.final('more', '去上海');
    vi.advanceTimersByTime(500);
    expect(second.commit).toHaveBeenCalledWith('明天 去上海', expect.anything(), 'original');
  });

  it('re-evaluates a wait decision instead of committing it', async () => {
    let decisions = 0;
    const policy: TurnPolicy = { decide: () => ({ disposition: ++decisions === 1 ? 'wait' : 'complete', confidence: 1, holdMs: 400, source: 'semantic' }) };
    const { turn, commit } = setup(policy);
    turn.final('first', '稍等');
    await vi.advanceTimersByTimeAsync(399);
    expect(commit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(commit).toHaveBeenCalledWith('稍等', expect.objectContaining({ disposition: 'complete' }), 'first');
  });

  it('clears pending output on reset and bounds transcript memory', () => {
    const { turn, commit } = setup();
    turn.final('first', '不要发送');
    turn.reset();
    vi.advanceTimersByTime(5_000);
    expect(commit).not.toHaveBeenCalled();
    expect(() => turn.final('long', 'a'.repeat(32_001))).toThrow('limit');
  });

  it('does not add another grace period when transcription finishes after speech stopped', () => {
    const { turn, commit } = setup();
    turn.start('one'); turn.stop('one');
    vi.advanceTimersByTime(600);
    turn.final('one', '今天天气怎么样？');
    vi.advanceTimersByTime(0);
    expect(commit).toHaveBeenCalledOnce();
  });

  it('cancels the fast commit when the user resumes speaking', () => {
    const { turn, commit } = setup();
    turn.final('one', '明天去上海');
    vi.advanceTimersByTime(20);
    turn.start('two');
    vi.advanceTimersByTime(200);
    expect(commit).not.toHaveBeenCalled();
    turn.final('two', '坐高铁');
    vi.advanceTimersByTime(40);
    expect(commit).toHaveBeenCalledWith('明天去上海 坐高铁', expect.anything(), 'one');
  });
});

describe('hasContinuationHint', () => {
  it.each(['我想……', '帮我查一下。', '因为，', '然后', 'I would like to...', 'because'])('holds an incomplete phrase: %s', text => {
    expect(hasContinuationHint(text)).toBe(true);
  });

  it.each(['今天天气怎么样？', '我要去上海。', '好的', '嗯，请继续', 'Hello.', 'What is the weather?'])('commits a complete phrase: %s', text => {
    expect(hasContinuationHint(text)).toBe(false);
  });
});

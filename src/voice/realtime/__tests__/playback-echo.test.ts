import { afterEach, describe, expect, it, vi } from 'vitest';

import { isLikelyPlaybackEcho, PlaybackEchoCandidates } from '../playback-echo.js';

describe('realtime playback echo detection', () => {
  it.each([
    ['今天天气怎么样', '我查到了：今天天气怎么样？答案是晴天。'],
    ['THE RESULT IS READY', 'The result is ready. I can summarize it now.'],
    ['今天天汽怎么样答案晴天', '我查到了：今天天气怎么样？答案是晴天。'],
    ['天气睛朗', '今天天气晴朗。'],
    ['the result is redy', 'The result is ready. I can summarize it now.'],
  ])('recognizes normalized speaker output: %s', (heard, spoken) => {
    expect(isLikelyPlaybackEcho(heard, spoken)).toBe(true);
  });

  it.each([
    ['停一下', '我查到了：今天天气怎么样？答案是晴天。'],
    ['好的', '好的，我来处理。'],
    ['show another result', 'The first result is ready.'],
    ['北京天气怎么样', '上海天气怎么样，今天是晴天。'],
  ])('keeps genuine or ambiguous barge-in speech: %s', (heard, spoken) => {
    expect(isLikelyPlaybackEcho(heard, spoken)).toBe(false);
  });
});


describe('playback echo candidates', () => {
  afterEach(() => vi.restoreAllMocks());

  it('checks delayed ASR against speech onset and consumes each candidate once', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const guard = new PlaybackEchoCandidates();
    guard.remember('echo', '今天天气晴朗。');
    now.mockReturnValue(6_000);
    expect(guard.matches('echo', '今天天气晴朗', '另一个回答。')).toBe(true);
    expect(guard.matches('echo', '今天天气晴朗')).toBe(false);
    guard.remember('user', '今天天气晴朗。');
    expect(guard.matches('user', '停一下')).toBe(false);
  });

  it('expires and clears candidates so old playback cannot suppress later speech', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const guard = new PlaybackEchoCandidates();
    guard.remember('old', '今天天气晴朗。');
    now.mockReturnValue(32_000);
    expect(guard.matches('old', '今天天气晴朗')).toBe(false);
    guard.remember('muted', '今天天气晴朗。');
    guard.clear();
    expect(guard.matches('muted', '今天天气晴朗')).toBe(false);
  });
});

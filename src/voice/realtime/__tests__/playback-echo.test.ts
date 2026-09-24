import { describe, expect, it } from 'vitest';

import { isLikelyPlaybackEcho } from '../playback-echo.js';

describe('realtime playback echo detection', () => {
  it.each([
    ['今天天气怎么样', '我查到了：今天天气怎么样？答案是晴天。'],
    ['THE RESULT IS READY', 'The result is ready. I can summarize it now.'],
    ['今天天汽怎么样答案晴天', '我查到了：今天天气怎么样？答案是晴天。'],
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

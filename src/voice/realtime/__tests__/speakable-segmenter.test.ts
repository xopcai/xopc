import { describe, expect, it } from 'vitest';

import { SpeakableSegmenter } from '../speakable-segmenter.js';

describe('SpeakableSegmenter', () => {
  it('emits complete phrases across token boundaries', () => {
    const segmenter = new SpeakableSegmenter();

    expect(segmenter.push('你好，今天')).toEqual([]);
    expect(segmenter.push('怎么样？我很好')).toEqual(['你好，今天怎么样？']);
    expect(segmenter.flush()).toEqual(['我很好']);
  });

  it('does not speak fenced code or split Markdown links across chunks', () => {
    const segmenter = new SpeakableSegmenter();
    const chunks = ['See **this** [guide](', 'https://example.com/a', ')!\n```ts\n', 'const secret = 1;\n', '```\nDone!'];
    const spoken = [...chunks.flatMap((chunk) => segmenter.push(chunk)), ...segmenter.flush()].join(' ');
    expect(spoken).toBe('See this guide! Done!');
  });

  it('keeps raw URLs and table rows out of audio', () => {
    const segmenter = new SpeakableSegmenter();
    const spoken = [...segmenter.push('Details: https://example.com/path \n| A | B |\n| 1 | 2 |\nDone!'), ...segmenter.flush()].join(' ');
    expect(spoken).toBe('Details: Done!');
  });

  it('bounds text without sentence punctuation', () => {
    const segmenter = new SpeakableSegmenter(10);

    expect(segmenter.push('12345 67890')).toEqual(['12345 6789']);
    expect(segmenter.flush()).toEqual(['0']);
  });

  it('coalesces short sentences to avoid standalone TTS gaps', () => {
    const segmenter = new SpeakableSegmenter(40, 8);

    expect(segmenter.push('你好。')).toEqual([]);
    expect(segmenter.push('马上处理。')).toEqual(['你好。马上处理。']);
  });

  it('can emit the first sentence immediately before coalescing later ones', () => {
    const segmenter = new SpeakableSegmenter(40, 8, 0);

    expect(segmenter.push('你好。')).toEqual(['你好。']);
    expect(segmenter.push('好的。')).toEqual([]);
    expect(segmenter.push('马上处理。')).toEqual(['好的。马上处理。']);
  });
});

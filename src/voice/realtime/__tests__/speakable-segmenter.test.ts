import { describe, expect, it } from 'vitest';

import { SpeakableSegmenter } from '../speakable-segmenter.js';

describe('SpeakableSegmenter', () => {
  it('emits complete phrases across token boundaries', () => {
    const segmenter = new SpeakableSegmenter();

    expect(segmenter.push('你好，今天')).toEqual([]);
    expect(segmenter.push('怎么样？我很好')).toEqual(['你好，今天怎么样？']);
    expect(segmenter.flush()).toEqual(['我很好']);
  });

  it('bounds text without sentence punctuation', () => {
    const segmenter = new SpeakableSegmenter(10);

    expect(segmenter.push('12345 67890')).toEqual(['12345 6789']);
    expect(segmenter.flush()).toEqual(['0']);
  });
});

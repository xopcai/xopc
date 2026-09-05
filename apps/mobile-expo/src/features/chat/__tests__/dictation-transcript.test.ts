import { describe, expect, it } from 'vitest';
import { DictationTranscript } from '../dictation-transcript';

describe('dictation transcript', () => {
  it('replaces partials, accepts a final at the same revision and ignores late partials', () => {
    const transcript = new DictationTranscript();
    transcript.update('a', 1, '今天', false);
    transcript.update('a', 2, '今天出发', false);
    transcript.update('a', 2, '今天出发。', true);
    transcript.update('a', 1, '今天', false);
    transcript.update('a', 2, '今天出发', false);
    expect(transcript.text()).toBe('今天出发。');
    expect(transcript.text(true)).toBe('今天出发。');
  });
  it('keeps utterance order through revisions and excludes unfinished speech from a committed result', () => {
    const transcript = new DictationTranscript();
    transcript.update('a', 1, '去上海', true);
    transcript.update('b', 1, '明天', false);
    transcript.update('a', 2, '去杭州。', true);
    expect(transcript.text()).toBe('去杭州。 明天');
    expect(transcript.text(true)).toBe('去杭州。');
  });
});

import { describe, expect, it } from 'vitest';
import { acceptTranscriptRevision } from '../transcript-revisions';

describe('transcript revisions', () => {
  it('accepts final text at the delta revision and rejects repeated finals and late deltas', () => {
    const revisions = new Map();
    expect(acceptTranscriptRevision(revisions, 'speaker', 0, false)).toBe(true);
    expect(acceptTranscriptRevision(revisions, 'speaker', 0, true)).toBe(true);
    expect(acceptTranscriptRevision(revisions, 'speaker', 0, true)).toBe(false);
    expect(acceptTranscriptRevision(revisions, 'speaker', 1, false)).toBe(false);
    expect(acceptTranscriptRevision(revisions, 'speaker', 1, true)).toBe(true);
    expect(acceptTranscriptRevision(revisions, 'other', 0, true)).toBe(true);
  });
});

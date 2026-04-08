import { describe, it, expect } from 'vitest';
import { detectSlashRange } from '@/features/chat/use-command-palette';

describe('detectSlashRange', () => {
  it('detects active slash token before cursor', () => {
    const t = '/he';
    const r = detectSlashRange(t, t.length);
    expect(r).toEqual({ start: 0, end: 3, query: 'he' });
  });

  it('returns null when cursor is not in slash token', () => {
    expect(detectSlashRange('hello', 5)).toBeNull();
  });

  it('handles slash after newline', () => {
    const t = 'x\n/new';
    const r = detectSlashRange(t, t.length);
    expect(r).toEqual({ start: 2, end: t.length, query: 'new' });
  });

  it('treats lone slash when cursor not yet synced', () => {
    expect(detectSlashRange('/', 0)).toEqual({ start: 0, end: 1, query: '' });
  });
});

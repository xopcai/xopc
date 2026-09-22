import { describe, expect, it } from 'vitest';
import { matchArtifactShare } from '../artifact-recovery.utils';
import type { ShareItem } from '@/features/shares/shares-api';

describe('artifact share matching', () => {
  const record = { id: 'stable-id', shareUrl: 'https://files.example/s/token', lanUrl: 'http://192.168.1.1/s/token' } as ShareItem;
  it('resolves only the exact managed origin and path', () => {
    expect(matchArtifactShare('https://files.example/s/token#preview', [record])?.id).toBe('stable-id');
    expect(matchArtifactShare('http://192.168.1.1/s/token', [record])?.id).toBe('stable-id');
    expect(matchArtifactShare('https://other.example/s/token', [record])).toBeUndefined();
    expect(matchArtifactShare('https://files.example/s/token-other', [record])).toBeUndefined();
    expect(matchArtifactShare('/tmp/file', [record])).toBeUndefined();
  });
});

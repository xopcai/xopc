import { describe, expect, it } from 'vitest';

import { applySessionPatchToMetadata } from '../patch-metadata.js';
import type { SessionMetadata } from '../types.js';
import { SessionStatus } from '../types.js';

const baseMeta = (overrides: Partial<SessionMetadata> = {}): SessionMetadata => ({
  key: 'agent:main:webchat:default:direct:u1',
  status: SessionStatus.ACTIVE,
  tags: ['a'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastAccessedAt: '2026-01-01T00:00:00.000Z',
  messageCount: 1,
  estimatedTokens: 10,
  compactedCount: 0,
  sourceChannel: 'webchat',
  sourceChatId: 'u1',
  ...overrides,
});

describe('applySessionPatchToMetadata', () => {
  it('merges tags by default', () => {
    const out = applySessionPatchToMetadata(baseMeta(), { tags: ['b'] });
    expect(out.tags).toEqual(['a', 'b']);
  });

  it('replaces tags when replaceTags is true', () => {
    const out = applySessionPatchToMetadata(baseMeta(), { tags: ['x'], replaceTags: true });
    expect(out.tags).toEqual(['x']);
  });

  it('shallow-merges customData', () => {
    const out = applySessionPatchToMetadata(
      baseMeta({ customData: { x: 1, y: 2 } }),
      { customData: { y: 3, z: 4 } },
    );
    expect(out.customData).toEqual({ x: 1, y: 3, z: 4 });
  });

  it('sets trimmed name', () => {
    const out = applySessionPatchToMetadata(baseMeta(), { name: '  Hello  ' });
    expect(out.name).toBe('Hello');
  });

  it('patches session visibility and project assignment', () => {
    const out = applySessionPatchToMetadata(baseMeta(), {
      hiddenFromSessionList: true,
      projectId: ' project-1 ',
    });
    expect(out).toMatchObject({
      hiddenFromSessionList: true,
      projectId: 'project-1',
    });
  });
});

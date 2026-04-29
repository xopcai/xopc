import { describe, expect, it } from 'vitest';

import { DREAMING_LAST_RUN_FORMAT_VERSION, parseDreamingLastRunFile } from '../last-run.js';

function validV2(): Record<string, unknown> {
  return {
    version: DREAMING_LAST_RUN_FORMAT_VERSION,
    phase: 'deep',
    runId: 'r1',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.500Z',
    durationMs: 1500,
    ok: true,
    reason: 'applied',
    config: { enabled: true, minScore: 0.8, minRecallCount: 3, limit: 10 },
    memoryPath: '/w/MEMORY.md',
    deep: {
      candidatesRanked: 3,
      applied: 1,
      skipped: {
        alreadyPromotedKey: 1,
        rehydrateFailed: 0,
        contaminated: 0,
        hashDuplicate: 1,
      },
    },
  };
}

describe('parseDreamingLastRunFile', () => {
  it('parses a complete v2 deep record', () => {
    const r = parseDreamingLastRunFile(validV2());
    expect(r).not.toBeNull();
    expect(r!.version).toBe(2);
    expect(r!.phase).toBe('deep');
    expect(r!.durationMs).toBe(1500);
    expect(r!.deep.candidatesRanked).toBe(3);
    expect(r!.deep.applied).toBe(1);
    expect(r!.deep.skipped.alreadyPromotedKey).toBe(1);
    expect(r!.deep.skipped.hashDuplicate).toBe(1);
  });

  it('rejects legacy v1 shapes', () => {
    const raw = {
      version: 1,
      runId: 'r0',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:02.000Z',
      ok: true,
      reason: 'x',
      config: { enabled: true, minScore: 0.5, minRecallCount: 2, limit: 5 },
      candidates: 2,
      applied: 0,
      memoryPath: 'MEMORY.md',
    };
    expect(parseDreamingLastRunFile(raw)).toBeNull();
  });

  it('rejects partial v2 (missing deep.skipped fields)', () => {
    const base = validV2();
    const bad = { ...base, deep: { candidatesRanked: 1, applied: 0, skipped: { alreadyPromotedKey: 0 } } };
    expect(parseDreamingLastRunFile(bad)).toBeNull();
  });

  it('returns null for invalid input', () => {
    expect(parseDreamingLastRunFile(null)).toBeNull();
    expect(parseDreamingLastRunFile({})).toBeNull();
    expect(parseDreamingLastRunFile({ version: 2, phase: 'rem' })).toBeNull();
  });
});

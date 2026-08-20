import { describe, expect, it } from 'vitest';

import type { MemoryTraceEventPayload } from '../../storage/sqlite/memory-records-repository.js';
import { summarizeMemoryUseAudit } from '../memory-use-audit.js';

describe('memory use audit', () => {
  it('separates actual memory use, skipped recalls, and user feedback', () => {
    const base = {
      traceId: 'trace',
      sessionKey: 'session',
      phase: 'inject',
      providerId: 'builtin',
      request: {},
      resultCount: 0,
      selectedRecordIds: [],
      feedback: [],
      durationMs: 1,
      createdAt: new Date(0).toISOString(),
    } satisfies MemoryTraceEventPayload;
    const audit = summarizeMemoryUseAudit([
      { ...base, traceId: 'used', selectedRecordIds: ['memory-1'], feedback: [{
        feedbackId: 'feedback', traceId: 'used', turnId: 'turn', level: 'response',
        rating: 'helpful', source: 'user', createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
      }] },
      { ...base, traceId: 'skipped', skippedReason: 'no_relevant_memory' },
    ]);
    expect(audit.turnsUsingMemory).toBe(1);
    expect(audit.selectedRecords).toBe(1);
    expect(audit.helpful).toBe(1);
    expect(audit.skippedReasons).toEqual({ no_relevant_memory: 1 });
  });
});

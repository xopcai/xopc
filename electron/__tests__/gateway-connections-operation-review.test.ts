import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { endpointToolRevision } from '@xopcai/endpoint-tools-client';
import { expect, it } from 'vitest';

import { DESKTOP_CLIPBOARD_WRITE_DESCRIPTOR } from '../desktop/clipboard-tool.js';
import { DesktopExecutionLease, DesktopOperationJournal, type DesktopOperationIntent } from '../desktop/operation-journal.js';
import { DesktopOperationReviewManager } from '../desktop/operation-review.js';

it('recovers offline metadata without credentials, requires native consent and never resets the old outcome', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'xopc-offline-review-'));
  const intent: DesktopOperationIntent = { operationId: randomUUID(), gatewayId: randomUUID(), deviceId: randomUUID(),
    tool: DESKTOP_CLIPBOARD_WRITE_DESCRIPTOR.name, toolRevision: endpointToolRevision(DESKTOP_CLIPBOARD_WRITE_DESCRIPTOR),
    argumentHash: 'a'.repeat(64), authorizationRevision: 1, expiresAt: Date.now() + 60000 };
  const seed = (operation: DesktopOperationIntent) => {
    const lease = new DesktopExecutionLease(directory), journal = new DesktopOperationJournal(lease);
    try { journal.record(operation); journal.start(operation, { invocationId: randomUUID(), connectionInstanceId: randomUUID() }); }
    finally { journal.close(); lease.close(); }
  };
  let allowed = false, approvals = 0;
  const review = new DesktopOperationReviewManager({ executorRoot: directory,
    manager: { snapshot: () => ({ epoch: 7, profiles: [] }) } as any,
    execution: { requireStopped: async () => {} } as any,
    store: {} as any, visible: () => true,
    confirm: async (binding, original, receipt) => {
      approvals += 1; expect(binding).toMatchObject({ gatewayId: intent.gatewayId, offline: true });
      expect(original).toEqual(intent); expect(receipt).toMatchObject({ state: 'unknown', executionStopped: true }); return allowed;
    } });
  try {
    seed(intent);
    expect(await review.listLocal(7)).toMatchObject([{ operationId: intent.operationId, intent }]);
    await expect(review.reviewLocal(7, intent.operationId)).rejects.toThrow('CONSENT_DENIED');
    expect(await review.listLocal(7)).toHaveLength(1);
    allowed = true;
    expect(await review.reviewLocal(7, intent.operationId)).toEqual({ operationId: intent.operationId, locallyReviewed: true, serverConfirmed: false, outcome: 'unknown' });
    expect(approvals).toBe(2); expect(await review.listLocal(7)).toEqual([]);
    const lease = new DesktopExecutionLease(directory), journal = new DesktopOperationJournal(lease);
    try {
      expect(journal.inspect(intent)).toMatchObject({ state: 'unknown', executionStopped: true });
      expect(journal.hasUnknown()).toBe(false);
      expect(() => journal.start(intent, { invocationId: randomUUID(), connectionInstanceId: randomUUID() })).toThrow('STATE_INVALID');
    } finally { journal.close(); lease.close(); }
    seed({ ...intent, operationId: randomUUID(), tool: 'fixture.unknown-process', toolRevision: 'b'.repeat(64) });
    const remaining = await review.listLocal(7);
    await expect(review.reviewLocal(7, remaining[0].operationId)).rejects.toThrow('STOP_UNCONFIRMED');
    expect(approvals).toBe(2);
    await expect(review.listLocal(6)).rejects.toThrow('STALE_CONNECTION_EPOCH');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

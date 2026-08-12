import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { ProactiveEventService } from '../service.js';
import { insertEvent } from '../events/repository.js';
import { normalizeEventEnvelope } from '../events/envelope.js';
import type { PublishEventInput } from '../events/types.js';
import type { ScenarioRoute } from '../routing/types.js';

const projectRisk: ScenarioRoute = {
  key: 'project_delivery_risk',
  version: 1,
  enabled: true,
  eventTypes: ['work_item.status_changed.v1'],
  condition: { op: 'changed', field: 'payload.status' },
  aggregation: 'project',
  debounceSeconds: 300,
  maxWindowSeconds: 1_800,
};

function event(overrides: Partial<PublishEventInput> = {}): PublishEventInput {
  return {
    type: 'work_item.status_changed.v1',
    schemaVersion: 1,
    source: { kind: 'work_items', id: 'local' },
    subject: { kind: 'work_item', id: 'work-1' },
    actor: { kind: 'user', id: 'user-1' },
    scope: { workspaceId: 'default', projectId: 'project-1' },
    occurredAt: '2026-08-12T02:00:00.000Z',
    dedupeKey: 'work-1:status:1',
    sensitivity: 'personal',
    payload: { before: { status: 'todo' }, after: { status: 'blocked' } },
    ...overrides,
  };
}

describe('proactive event spine', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-proactive-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('stores one immutable event and returns the original for duplicate delivery', () => {
    const service = new ProactiveEventService(() => [projectRisk]);
    const first = service.publish(event(), new Date('2026-08-12T02:00:01.000Z'));
    const duplicate = service.publish(
      event({ payload: { before: { status: 'todo' }, after: { status: 'done' } } }),
      new Date('2026-08-12T02:01:00.000Z'),
    );

    expect(first.inserted).toBe(true);
    expect(first.batchIds).toHaveLength(1);
    expect(duplicate.inserted).toBe(false);
    expect(duplicate.event.id).toBe(first.event.id);
    expect(duplicate.event.payload).toEqual({ before: { status: 'todo' }, after: { status: 'blocked' } });
    expect(service.listEvents()).toHaveLength(1);
    expect(service.listBatches()).toHaveLength(1);
    expect(service.listBatches()[0]?.eventCount).toBe(1);
  });

  it('debounces matching events into one project batch and marks it ready durably', () => {
    const service = new ProactiveEventService(() => [projectRisk]);
    service.publish(event(), new Date('2026-08-12T02:00:01.000Z'));
    service.publish(event({
      subject: { kind: 'work_item', id: 'work-2' },
      dedupeKey: 'work-2:status:1',
    }), new Date('2026-08-12T02:02:00.000Z'));

    const batch = service.listBatches()[0];
    expect(batch).toMatchObject({ aggregationKey: 'project:project-1', eventCount: 2, status: 'collecting' });
    expect(batch?.readyAt).toBe('2026-08-12T02:07:00.000Z');
    expect(service.markReadyBatches(new Date('2026-08-12T02:07:00.000Z'))).toBe(1);
    expect(service.listBatches()[0]?.status).toBe('ready');
  });

  it('finishes routing when a duplicate repairs an event persisted before routing', () => {
    const pending = normalizeEventEnvelope(event(), new Date('2026-08-12T02:00:01.000Z'));
    expect(insertEvent(pending)).toBe(true);

    const service = new ProactiveEventService(() => [projectRisk]);
    const repaired = service.publish(event(), new Date('2026-08-12T02:01:00.000Z'));

    expect(repaired.inserted).toBe(false);
    expect(repaired.batchIds).toHaveLength(1);
    expect(service.listBatches()[0]?.eventCount).toBe(1);
    expect(service.publish(event()).batchIds).toEqual([]);
  });

  it('starts a new batch after the maximum aggregation window', () => {
    const service = new ProactiveEventService(() => [projectRisk]);
    service.publish(event(), new Date('2026-08-12T02:00:00.000Z'));
    service.publish(event({
      subject: { kind: 'work_item', id: 'work-2' },
      dedupeKey: 'work-2:status:2',
    }), new Date('2026-08-12T02:31:00.000Z'));

    const batches = service.listBatches();
    expect(batches).toHaveLength(2);
    expect(batches.map((batch) => batch.status).sort()).toEqual(['collecting', 'ready']);
  });

  it('does not route events that fail conditions or lack the aggregation scope', () => {
    const service = new ProactiveEventService(() => [projectRisk]);
    service.publish(event({
      dedupeKey: 'work-1:unchanged:1',
      payload: { before: { status: 'todo' }, after: { status: 'todo' } },
    }));
    service.publish(event({
      dedupeKey: 'work-1:no-project:1',
      scope: { workspaceId: 'default' },
    }));
    expect(service.listEvents()).toHaveLength(2);
    expect(service.listBatches()).toHaveLength(0);
  });

  it('rejects malformed event types and timestamps before persistence', () => {
    const service = new ProactiveEventService();
    expect(() => service.publish(event({ type: 'work_item.changed' }))).toThrow(/domain\.event\.vN/);
    expect(() => service.publish(event({ occurredAt: 'not-a-date' }))).toThrow(/ISO timestamp/);
    expect(service.listEvents()).toHaveLength(0);
  });

  it('fails closed when a condition exceeds the supported nesting depth', () => {
    let condition: ScenarioRoute['condition'] = { op: 'eq', field: 'payload.status', value: 'blocked' };
    for (let depth = 0; depth < 8; depth += 1) condition = { op: 'not', condition };
    const service = new ProactiveEventService(() => [{ ...projectRisk, condition }]);

    service.publish(event({ payload: { status: 'blocked' } }));

    expect(service.listBatches()).toHaveLength(0);
  });
});

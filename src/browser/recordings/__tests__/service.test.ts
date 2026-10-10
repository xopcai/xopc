import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { useTestDatabase } from '../../../storage/sqlite/__tests__/test-database.js';
import { BrowserAutomationService } from '../../automations/service.js';
import { BrowserRecordingService } from '../service.js';

useTestDatabase();
function services() {
  const executor = vi.fn(async () => ({ ok: true, businessOutcome: 'verified' as const }));
  const automations = new BrowserAutomationService(executor);
  return { automations, executor, recordings: new BrowserRecordingService(automations) };
}
const event = (seq: number) => ({ id: randomUUID(), seq, sourceSeq: seq, documentId: 'document-1', url: 'https://example.com', action: 'navigate' as const });

describe('recording persistence', () => {
  it('acknowledges retransmission and rejects gaps, conflicts and another device', () => {
    const { recordings } = services();
    const id = randomUUID();
    const first = event(1);
    expect(recordings.append(id, 'device-1', [first])).toEqual({ ackThrough: 1 });
    expect(recordings.append(id, 'device-1', [first])).toEqual({ ackThrough: 1 });
    expect(() => recordings.append(id, 'device-1', [event(3)])).toThrow('gap');
    expect(() => recordings.append(id, 'device-1', [{ ...first, url: 'https://changed.example' }])).toThrow('conflict');
    expect(() => recordings.append(id, 'device-2', [first])).toThrow('another device');
  });

  it('never executes the recorded submission when finishing or finishing twice', () => {
    const { recordings, automations, executor } = services();
    const id = randomUUID();
    recordings.append(id, 'device', [event(1), { ...event(2), action: 'click', target: { role: 'button', name: 'Submit' } }, { ...event(3), action: 'checkpoint' }]);
    expect(() => recordings.finish(id, 'device', 4)).toThrow('incomplete');
    const saved = recordings.finish(id, 'device', 3)!;
    expect(saved.verified).toBe(false);
    expect(saved.definition.steps.at(-1)).toEqual({ action: 'click', target: { role: 'button', name: 'Submit' } });
    expect(recordings.finish(id, 'device', 3)?.revision).toBe(saved.revision);
    expect(() => recordings.finish(id, 'device', 4)).toThrow('conflicts');
    expect(automations.list()).toHaveLength(1);
    expect(executor).not.toHaveBeenCalled();
  });

  it('refuses to compile missing source events even when upload sequences are contiguous', () => {
    const { recordings } = services();
    const id = randomUUID();
    recordings.append(id, 'device', [event(1), { ...event(2), sourceSeq: 3 }]);
    expect(() => recordings.finish(id, 'device', 2)).toThrow('document events');
  });
});

describe('automation versions and execution evidence', () => {
  it('preserves verified revisions, resets proof on edits, and deduplicates execution', async () => {
    const { automations, executor } = services();
    const definition = { id: 'read-example', name: 'Read example', risk: 'read', allowedDomains: ['example.com'], inputs: {},
      steps: [{ action: 'navigate', url: 'https://example.com' }], successCriteria: [{ field: 'title', equals: 'Example' }] };
    const saved = automations.save({ definition });
    const run = await automations.runAndWait(saved.id, {}, undefined, { clientRequestId: 'request-1' });
    expect(automations.get(saved.id)?.verified).toBe(true);
    const duplicate = await automations.runAndWait(saved.id, {}, undefined, { clientRequestId: 'request-1' });
    expect(duplicate.id).toBe(run.id);
    expect(executor).toHaveBeenCalledOnce();
    expect(automations.save({ definition, status: 'disabled' }).revision).toBe(1);
    const changed = automations.save({ definition: { ...definition, name: 'Changed' }, status: 'enabled', expectedRevision: 1 });
    expect(changed.revision).toBe(2);
    expect(changed.verified).toBe(false);
    expect(() => automations.startRun(saved.id, {}, { clientRequestId: 'request-1', revision: 2 })).toThrow('revision or inputs');
    expect(automations.versions(saved.id).map((item) => item.verified)).toEqual([false, true]);
    expect(() => automations.save({ definition, expectedRevision: 1 })).toThrow('revision changed');
  });
});

import { normalizeEventEnvelope } from './events/envelope.js';
import {
  getEventByDedupeKey,
  insertEvent,
  isEventRouted,
  listEvents,
  markEventRouted,
} from './events/repository.js';
import type { PublishEventInput, PublishedEvent } from './events/types.js';
import { addEventToBatch, listBatches, markReadyBatches } from './routing/batch-repository.js';
import { matchScenario } from './routing/matcher.js';
import type { ScenarioRoute } from './routing/types.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';

export class ProactiveEventService {
  constructor(private readonly routes: () => readonly ScenarioRoute[] = () => []) {}

  publish(input: PublishEventInput, now = new Date()): PublishedEvent {
    let event = normalizeEventEnvelope(input, now);
    const inserted = insertEvent(event);
    if (!inserted) {
      const existing = getEventByDedupeKey(event.dedupeKey);
      if (!existing) throw new Error(`Proactive event dedupe lookup failed: ${event.dedupeKey}`);
      event = existing;
      if (isEventRouted(event.id)) return { event, inserted: false, batchIds: [] };
    }

    const batchIds = this.routes().flatMap((scenario) => {
      const key = matchScenario(event, scenario);
      if (!key) return [];
      return [addEventToBatch({ event, scenario, aggregationKey: key, now }).id];
    });
    markEventRouted(event.id, now.toISOString());
    return { event, inserted, batchIds };
  }

  listEvents = listEvents;
  listBatches = listBatches;
  markReadyBatches = markReadyBatches;

  health(): { events: number; collecting: number; ready: number; oldestReadyAt: string | null } {
    const db = getSqliteDatabase();
    const events = db.prepare('SELECT COUNT(*) AS count FROM proactive_events').get() as { count: number };
    const batches = db.prepare(`SELECT
      SUM(CASE WHEN status = 'collecting' THEN 1 ELSE 0 END) AS collecting,
      SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS ready,
      MIN(CASE WHEN status = 'ready' THEN ready_at END) AS oldest_ready_at
      FROM proactive_signal_batches`).get() as { collecting: number | null; ready: number | null; oldest_ready_at: string | null };
    return {
      events: events.count,
      collecting: batches.collecting ?? 0,
      ready: batches.ready ?? 0,
      oldestReadyAt: batches.oldest_ready_at,
    };
  }
}

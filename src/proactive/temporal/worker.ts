import { getConnectorSyncPolicy } from '../../storage/sqlite/connector-sync-policy-repository.js';
import { listKnowledgeSourceItems } from '../../storage/sqlite/knowledge-repository.js';
import { createLogger } from '../../utils/logger.js';
import { ProactiveEventService } from '../service.js';

const log = createLogger('Proactive:Temporal');
const MEETING_SCENARIO = 'meeting_preparation';

export type TemporalTickResult = {
  scanned: number;
  published: number;
  skipped: number;
};

function metadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function meetingWindow(startMs: number, nowMs: number): '2h' | '24h' | null {
  const untilStart = startMs - nowMs;
  if (untilStart <= 0) return null;
  if (untilStart <= 2 * 60 * 60_000) return '2h';
  if (untilStart <= 24 * 60 * 60_000) return '24h';
  return null;
}

export class ProactiveTemporalWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly events: ProactiveEventService,
    private readonly intervalMs = 60_000,
  ) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), Math.max(5_000, this.intervalMs));
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(now = new Date()): Promise<TemporalTickResult> {
    if (this.running) return { scanned: 0, published: 0, skipped: 0 };
    this.running = true;
    const result: TemporalTickResult = { scanned: 0, published: 0, skipped: 0 };
    try {
      const items = listKnowledgeSourceItems({ itemType: 'calendar_event', limit: 500 });
      for (const item of items) {
        result.scanned += 1;
        const connectionId = metadataString(item.metadata, 'connectionId');
        const workspaceId = metadataString(item.metadata, 'workspaceId');
        const connectorId = metadataString(item.metadata, 'connectorId');
        const agentId = metadataString(item.metadata, 'agentId');
        const startMs = item.occurredAt ? Date.parse(item.occurredAt) : Number.NaN;
        const window = meetingWindow(startMs, now.getTime());
        const policy = connectionId ? getConnectorSyncPolicy(connectionId) : undefined;
        const scenarioAllowed = !policy?.allowedScenarioKeys.length
          || policy.allowedScenarioKeys.includes(MEETING_SCENARIO);
        if (!connectionId || !workspaceId || !connectorId || !window
          || !policy?.scanEnabled || !policy.proactiveEnabled || !scenarioAllowed
          || item.sensitivity === 'secret' || item.sensitivity === 'regulated') {
          result.skipped += 1;
          continue;
        }
        const published = this.events.publish({
          type: 'connected_source.calendar_window.v1',
          schemaVersion: 1,
          source: { kind: 'connector', id: connectionId },
          subject: { kind: 'knowledge_source_item', id: item.id },
          actor: { kind: 'system' },
          scope: { workspaceId, ...(agentId ? { agentId } : {}) },
          occurredAt: now.toISOString(),
          dedupeKey: `calendar-window:${item.id}:${item.occurredAt}:${window}`,
          sensitivity: item.sensitivity === 'normal' ? 'personal' : item.sensitivity,
          payload: {
            sourceItemId: item.id,
            meetingStartsAt: item.occurredAt,
            window,
          },
        }, now);
        if (published.inserted) result.published += 1;
      }
      if (result.published > 0) {
        log.info(result, 'Temporal meeting signals published');
      }
      return result;
    } finally {
      this.running = false;
    }
  }
}

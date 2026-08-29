import { createHash } from 'node:crypto';

import type { Config } from '../config/schema.js';
import {
  claimConnectorWebhookDelivery,
  completeConnectorWebhookDelivery,
  releaseConnectorWebhookDelivery,
} from '../storage/sqlite/index.js';
import { createLogger } from '../utils/logger.js';
import { ManagedComposioClient } from './composio-managed-client.js';
import { resolveComposioApiKey } from './composio-sessions.js';
import {
  appendComposioTriggerEvent,
  applyComposioConnectionLifecycleEvent,
  normalizeComposioTriggerPayload,
} from './composio-triggers.js';

const log = createLogger('Connectors:ComposioManagedEvents');

type ManagedEvent = {
  sequence: number;
  id: string;
  type: string;
  toolkit?: string;
  connectionId?: string;
  payload: unknown;
  createdAt: string;
};

type ManagedEventClient = {
  events(after?: number, limit?: number): Promise<{ items: ManagedEvent[]; nextCursor: number }>;
};

function hasInstalledComposioToolkit(config: Config): boolean {
  return Object.values(config.connectors?.instances ?? {}).some((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const runtime = (value as Record<string, unknown>).runtime;
    return Boolean(runtime && typeof runtime === 'object' && !Array.isArray(runtime)
      && (runtime as Record<string, unknown>).type === 'composio'
      && (runtime as Record<string, unknown>).role === 'toolkit');
  });
}

export class ManagedComposioEventPoller {
  private timer?: ReturnType<typeof setInterval>;
  private cursor = 0;
  private syncing?: Promise<void>;

  constructor(private readonly input: {
    getConfig: () => Config;
    triggerAutomation: (event: { type: string; source: string; payload: Record<string, unknown> }) => Promise<unknown>;
    requestLearning: (toolkit: string) => void;
    setLearningPaused: (connectionId: string, paused: boolean) => void;
    client?: ManagedEventClient;
    hasByok?: () => Promise<boolean>;
    intervalMs?: number;
  }) {}

  start(): void {
    if (this.timer) return;
    void this.sync().catch(() => {});
    this.timer = setInterval(() => { void this.sync().catch(() => {}); }, this.input.intervalMs ?? 15_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  sync(): Promise<void> {
    this.syncing ??= this.runSync().finally(() => { this.syncing = undefined; });
    return this.syncing;
  }

  private async runSync(): Promise<void> {
    const config = this.input.getConfig();
    const hasByok = this.input.hasByok ?? (async () => Boolean(await resolveComposioApiKey()));
    if (!hasInstalledComposioToolkit(config) || await hasByok()) return;
    const client = this.input.client ?? new ManagedComposioClient();
    try {
      for (let page = 0; page < 20; page += 1) {
        const response = await client.events(this.cursor, 100);
        for (const event of response.items) await this.process(config, event);
        const next = Math.max(this.cursor, response.nextCursor);
        if (next === this.cursor || response.items.length === 0) break;
        this.cursor = next;
        if (response.items.length < 100) break;
      }
    } catch (error) {
      log.debug({ err: error, phase: 'event_poll' }, 'Managed Composio event poll skipped');
      throw error;
    }
  }

  private async process(config: Config, event: ManagedEvent): Promise<void> {
    const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
      ? { ...event.payload as Record<string, unknown>, id: event.id }
      : { id: event.id, type: event.type, data: event.payload };
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const claim = claimConnectorWebhookDelivery({ id: event.id, provider: 'composio', payloadHash: hash });
    if (claim !== 'claimed') return;
    try {
      const normalized = normalizeComposioTriggerPayload(payload, event.id);
      const inactiveConnectionId = applyComposioConnectionLifecycleEvent(payload);
      if (inactiveConnectionId) this.input.setLearningPaused(inactiveConnectionId, true);
      await appendComposioTriggerEvent(config, payload);
      const toolkit = normalized.toolkit ?? event.toolkit;
      if (toolkit) this.input.requestLearning(toolkit);
      await this.input.triggerAutomation({
        type: `connector.${normalized.trigger ?? normalized.type}`,
        source: toolkit ? `composio:${toolkit}` : 'composio',
        payload: {
          ...normalized.data,
          connectorId: toolkit ? `composio-${toolkit}` : 'composio',
          webhookId: event.id,
        },
      });
      completeConnectorWebhookDelivery(event.id);
    } catch (error) {
      releaseConnectorWebhookDelivery(event.id, error);
      throw error;
    }
  }
}

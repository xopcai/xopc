import fs from 'node:fs/promises';
import path from 'node:path';

import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import { createLogger } from '../../utils/logger.js';
import { resolveDreamingConfig } from '../memory/dreaming/config.js';
import {
  SHORT_TERM_PROMOTION_LOCK_RELATIVE,
  SHORT_TERM_RECALL_STORE_RELATIVE,
} from '../memory/dreaming/constants.js';
import { loadDreamingStore, saveDreamingStore } from '../memory/dreaming/short-term-store.js';

const log = createLogger('DreamingTool');

const DreamingSchema = Type.Object({
  action: Type.Union([Type.Literal('status'), Type.Literal('reset_store'), Type.Literal('clear_lock')]),
});

type DreamingParams = {
  action: 'status' | 'reset_store' | 'clear_lock';
};

export interface DreamingToolDeps {
  getWorkspace: () => string;
  getDreamingRoot: () => string;
  getConfig: () => Config | undefined;
  getAgentId?: () => string | undefined;
}

function textResult(text: string): AgentToolResult<{}> {
  return { content: [{ type: 'text', text }], details: {} };
}

function safeStatMs(ms: number | undefined): number | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  return Math.floor(ms);
}

function isoDay(isoLike: string | undefined): string | null {
  if (!isoLike) return null;
  const m = isoLike.match(/^(\d{4}-\d{2}-\d{2})/);
  return m?.[1] ?? null;
}

export function createDreamingTool(deps: DreamingToolDeps): AgentTool {
  return {
    name: 'dreaming',
    label: '💤 Dreaming',
    description:
      'Inspect and maintain the dreaming promotion state.\n\n' +
      'Actions:\n' +
      '- status: show config gates and short-term store stats\n' +
      '- reset_store: clear this agent short-term recall store (.dreams/short-term-recall.json)\n' +
      '- clear_lock: remove this agent stale promotion lock file (.dreams/short-term-promotion.lock)',
    parameters: DreamingSchema,
    async execute(_toolCallId, params: any): Promise<AgentToolResult<{}>> {
      const action = (params as DreamingParams).action;
      const dreamingRoot = deps.getDreamingRoot();
      const cfg = deps.getConfig();
      const agentId = deps.getAgentId?.();
      const resolved = resolveDreamingConfig(cfg, agentId);

      const storePath = path.join(dreamingRoot, SHORT_TERM_RECALL_STORE_RELATIVE);
      const lockPath = path.join(dreamingRoot, SHORT_TERM_PROMOTION_LOCK_RELATIVE);

      if (action === 'status') {
        const { store } = await loadDreamingStore({ dreamingRoot });
        const entries = Object.values(store.entries ?? {});
        const total = entries.length;
        const promoted = entries.filter((e) => Boolean(e.promotedAt)).length;
        const today = new Date().toISOString().slice(0, 10);
        const promotedToday = entries.filter((e) => isoDay(e.promotedAt) === today).length;
        const lastPromotedAt = entries
          .map((e) => e.promotedAt)
          .filter((x): x is string => typeof x === 'string' && x.length > 0)
          .sort()
          .at(-1);

        const lockStat = await fs.stat(lockPath).catch(() => null);
        const lockAgeMs =
          lockStat && safeStatMs(lockStat.mtimeMs) ? Date.now() - Math.floor(lockStat.mtimeMs) : null;

        const lines = [
          'Dreaming status',
          '',
          `enabled: ${resolved.enabled ? 'true' : 'false'}`,
          `deep.enabled: ${resolved.deep.enabled ? 'true' : 'false'}`,
          `cron.frequency: ${resolved.frequency}`,
          `cron.timezone: ${resolved.timezone ?? '(default)'}`,
          `deep.minScore: ${resolved.deep.minScore}`,
          `deep.minRecallCount: ${resolved.deep.minRecallCount}`,
          `deep.limit: ${resolved.deep.limit}`,
          '',
          `agentId: ${agentId ?? '(unknown)'}`,
          `storePath: ${storePath}`,
          `entryCount: ${total}`,
          `promotedCount: ${promoted}`,
          `promotedToday: ${promotedToday}`,
          `lastPromotedAt: ${lastPromotedAt ?? '(none)'}`,
          '',
          `lockPath: ${SHORT_TERM_PROMOTION_LOCK_RELATIVE}`,
          `lockPresent: ${lockStat ? 'true' : 'false'}`,
          `lockAgeMs: ${lockAgeMs ?? '(n/a)'}`,
        ];
        return textResult(lines.join('\n'));
      }

      if (action === 'reset_store') {
        const { store } = await loadDreamingStore({ dreamingRoot });
        const before = Object.keys(store.entries ?? {}).length;
        const nowIso = new Date().toISOString();
        store.entries = {};
        store.updatedAt = nowIso;
        await saveDreamingStore({ dreamingRoot, store });
        log.info({ dreamingRoot, before }, 'Dreaming store reset');
        return textResult(
          `Reset short-term store. Removed ${before} entr${before === 1 ? 'y' : 'ies'}. Path: ${storePath}`,
        );
      }

      await fs.unlink(lockPath).catch(() => {});
      return textResult(`Cleared lock (if present). Path: ${lockPath}`);
    },
  } as any;
}

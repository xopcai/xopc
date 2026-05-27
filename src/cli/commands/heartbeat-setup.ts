/**
 * Gateway heartbeat setup handlers — loaded via gateway command module.
 */

import { loadConfig } from '../../config/loader.js';
import type { Config } from '../../config/schema.js';
import {
  applyHeartbeatPatch,
  type HeartbeatPatchFields,
} from '../../config/setup-writes/index.js';
import { isRecord } from '../../utils/is-record.js';

import { registerSetupDomain, registerSetupHandler, runSetupHeadless } from './setup-shared/index.js';

function parseHeartbeatConfigureFields(fields: Record<string, unknown>): {
  patch: HeartbeatPatchFields;
  errors: Array<{ path?: string; message: string }>;
} {
  const patch: HeartbeatPatchFields = {};
  const errors: Array<{ path?: string; message: string }> = [];

  if (fields.enabled !== undefined) patch.enabled = fields.enabled === true;
  if (fields.includeSystemPromptSection !== undefined) {
    patch.includeSystemPromptSection = fields.includeSystemPromptSection === true;
  }
  if (fields.isolatedSession !== undefined) {
    patch.isolatedSession = fields.isolatedSession === true;
  }
  if (fields.target !== undefined && typeof fields.target === 'string') {
    patch.target = fields.target;
  }
  if (fields.targetChatId !== undefined && typeof fields.targetChatId === 'string') {
    patch.targetChatId = fields.targetChatId;
  }
  if (fields.prompt !== undefined && typeof fields.prompt === 'string') {
    patch.prompt = fields.prompt;
  }
  if (fields.ackMaxChars !== undefined) {
    if (fields.ackMaxChars === null || fields.ackMaxChars === '') {
      patch.ackMaxChars = '';
    } else if (typeof fields.ackMaxChars === 'number' && Number.isFinite(fields.ackMaxChars)) {
      patch.ackMaxChars = fields.ackMaxChars;
    } else {
      errors.push({ path: 'ackMaxChars', message: 'ackMaxChars must be a number or empty' });
    }
  }
  if (fields.intervalMs !== undefined) {
    const n =
      typeof fields.intervalMs === 'number'
        ? fields.intervalMs
        : Number.parseInt(String(fields.intervalMs), 10);
    if (!Number.isFinite(n) || n < 60_000) {
      errors.push({ path: 'intervalMs', message: 'intervalMs must be at least 60000 (1 minute)' });
    } else {
      patch.intervalMs = Math.floor(n);
    }
  }
  if (fields.activeHours !== undefined) {
    if (fields.activeHours === null) {
      patch.activeHours = null;
    } else if (isRecord(fields.activeHours)) {
      patch.activeHours = {
        start: typeof fields.activeHours.start === 'string' ? fields.activeHours.start : '',
        end: typeof fields.activeHours.end === 'string' ? fields.activeHours.end : '',
        timezone:
          typeof fields.activeHours.timezone === 'string' ? fields.activeHours.timezone : undefined,
      };
    } else {
      errors.push({ path: 'activeHours', message: 'activeHours must be an object or null' });
    }
  }

  if (Object.keys(patch).length === 0 && errors.length === 0) {
    errors.push({ message: 'At least one heartbeat field is required' });
  }

  return { patch, errors };
}

function readHeartbeatValue(cfg: Config): Record<string, unknown> {
  const hb = (cfg.gateway?.heartbeat ?? {}) as Record<string, unknown>;
  return {
    enabled: hb.enabled === true,
    intervalMs:
      typeof hb.intervalMs === 'number' && Number.isFinite(hb.intervalMs)
        ? hb.intervalMs
        : 1_800_000,
    includeSystemPromptSection: hb.includeSystemPromptSection === true,
    target: typeof hb.target === 'string' ? hb.target : '',
    targetChatId: typeof hb.targetChatId === 'string' ? hb.targetChatId : '',
    prompt: typeof hb.prompt === 'string' ? hb.prompt : '',
    ackMaxChars:
      typeof hb.ackMaxChars === 'number' && Number.isFinite(hb.ackMaxChars) ? hb.ackMaxChars : null,
    isolatedSession: hb.isolatedSession === true,
    activeHours: hb.activeHours ?? null,
  };
}

registerSetupHandler({
  domain: 'heartbeat',
  action: 'configure',
  handler: async ({ configPath, fields, options }) => {
    const { patch, errors } = parseHeartbeatConfigureFields(fields);
    if (errors.length > 0) {
      return {
        ok: false,
        action: 'set',
        domain: 'heartbeat',
        changedPaths: [],
        dryRun: options.dryRun,
        errors,
      };
    }
    return runSetupHeadless({
      configPath,
      options,
      mutator: {
        domain: 'heartbeat',
        action: 'set',
        mutate: (cfg) => applyHeartbeatPatch(cfg, patch),
        resultValue: (cfg) => readHeartbeatValue(cfg),
      },
    });
  },
});

registerSetupDomain({
  domain: 'heartbeat',
  description: 'Gateway heartbeat polling (scheduled agent turns).',
  docs: 'https://xopcai.github.io/xopc/heartbeat',
  storage: 'cfg.gateway.heartbeat in ~/.xopc/xopc.json',
  actions: [
    {
      name: 'configure',
      cli: 'POST /api/setup/heartbeat/configure',
      description: 'Update heartbeat enable flag, interval, target channel, prompt, active hours.',
      fields: [
        'enabled',
        'intervalMs',
        'target',
        'targetChatId',
        'prompt',
        'ackMaxChars',
        'isolatedSession',
        'includeSystemPromptSection',
        'activeHours',
      ],
    },
  ],
  fields: {
    enabled: { type: 'boolean', description: 'Enable periodic heartbeat runs.' },
    intervalMs: {
      type: 'number',
      description: 'Interval between heartbeat runs in milliseconds (min 60000).',
    },
    target: { type: 'string', description: 'Delivery channel id (e.g. telegram).' },
    targetChatId: { type: 'string', description: 'Optional chat id within the target channel.' },
    prompt: { type: 'string', description: 'Custom heartbeat prompt override.' },
    activeHours: {
      type: 'string',
      description: 'Optional { start, end, timezone? } window or null to clear.',
    },
  },
});

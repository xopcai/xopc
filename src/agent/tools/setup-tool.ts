import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

import {
  ensureSetupHandlersLoaded,
  getSetupHandler,
  serializeSetupManifest,
  type SetupAction,
  type SetupOutcome,
} from '../../cli/commands/setup-shared/index.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('SetupTool');

const SECRET_FIELD_NAMES = new Set([
  'key',
  'token',
  'apiKey',
  'api_key',
  'password',
  'secret',
  'botToken',
  'bot_token',
]);

function maskSecretValue(value: string): string {
  const t = value.trim();
  if (t.length <= 8) return '*'.repeat(t.length);
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

function redactFieldsForLog(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string' && SECRET_FIELD_NAMES.has(k)) {
      out[k] = maskSecretValue(v);
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redactFieldsForLog(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

const SetupToolSchema = Type.Object({
  op: Type.Union([
    Type.Literal('manifest'),
    Type.Literal('invoke'),
  ], { description: 'manifest: list setup domains/actions; invoke: run a setup handler.' }),
  domain: Type.Optional(
    Type.String({ description: 'Setup domain (required for invoke). e.g. providers, search, voice, channels.telegram' }),
  ),
  action: Type.Optional(
    Type.String({ description: 'Setup action (required for invoke). e.g. set-key, add, configure' }),
  ),
  fields: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description: 'Action-specific fields (secrets allowed — never echoed in replies).',
    }),
  ),
  dryRun: Type.Optional(
    Type.Boolean({ description: 'When true, validate and compute diff without writing.' }),
  ),
});

export interface SetupToolDeps {
  getConfigPath: () => string;
  /** Called after a successful non-dry-run write (e.g. gateway reloadConfig). */
  onSetupApplied?: (outcome: SetupOutcome) => Promise<void>;
}

function formatOutcomeText(outcome: SetupOutcome): string {
  return JSON.stringify(outcome, null, 2);
}

export function createSetupTool(deps: SetupToolDeps): AgentTool<any, any> {
  return {
    name: 'setup',
    label: '⚙️ Setup',
    description:
      'Configure xopc through the unified setup pipeline (same as Settings forms and POST /api/setup).\n\n' +
      'Use `op: manifest` to discover domains and actions.\n' +
      'Use `op: invoke` with domain, action, and fields to apply changes. Prefer dryRun first.\n\n' +
      'For secrets (API keys, bot tokens): only pass them in `fields` when the user already provided them in chat. ' +
      'Otherwise guide the user to the Settings UI.',
    parameters: SetupToolSchema,

    async execute(
      _toolCallId: string,
      params: any,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult<any>> {
      const p = params as {
        op: 'manifest' | 'invoke';
        domain?: string;
        action?: string;
        fields?: Record<string, unknown>;
        dryRun?: boolean;
      };

      await ensureSetupHandlersLoaded();

      if (p.op === 'manifest') {
        const manifest = serializeSetupManifest();
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: true, ...manifest }, null, 2) }],
          details: { manifest },
        };
      }

      const domain = p.domain?.trim();
      const action = p.action?.trim();
      if (!domain || !action) {
        const err: SetupOutcome = {
          ok: false,
          action: 'noop',
          domain: domain ?? '',
          changedPaths: [],
          dryRun: Boolean(p.dryRun),
          errors: [{ message: 'domain and action are required when op is invoke' }],
        };
        return {
          content: [{ type: 'text', text: formatOutcomeText(err) }],
          details: { outcome: err },
        };
      }

      const entry = getSetupHandler(domain, action);
      if (!entry) {
        const err: SetupOutcome = {
          ok: false,
          action: action as SetupAction,
          domain,
          changedPaths: [],
          dryRun: Boolean(p.dryRun),
          errors: [{ message: `No setup handler registered for ${domain}/${action}. Use op manifest to list actions.` }],
        };
        return {
          content: [{ type: 'text', text: formatOutcomeText(err) }],
          details: { outcome: err },
        };
      }

      const fields = p.fields && typeof p.fields === 'object' && !Array.isArray(p.fields) ? p.fields : {};
      const dryRun = Boolean(p.dryRun);
      const configPath = deps.getConfigPath();

      log.info(
        { domain, action, dryRun, configPath, fields: redactFieldsForLog(fields) },
        'Setup tool invoke',
      );

      const outcome = await entry.handler({
        configPath,
        fields,
        options: { dryRun, json: true },
      });

      if (outcome.ok && !outcome.dryRun && outcome.changedPaths.length > 0 && deps.onSetupApplied) {
        try {
          await deps.onSetupApplied(outcome);
        } catch (err) {
          log.warn({ err, domain, action }, 'Setup write succeeded but onSetupApplied failed');
        }
      }

      return {
        content: [{ type: 'text', text: formatOutcomeText(outcome) }],
        details: { outcome },
      };
    },
  } as any;
}

/**
 * Agent defaults setup handlers — loaded via models command module.
 */

import type { Config } from '../../config/schema.js';
import {
  applyAgentDefaultModelPatch,
  buildAgentDefaultModelField,
} from '../../config/setup-writes/index.js';
import { resolveModel } from '../../providers/index.js';
import { isRecord } from '../../utils/is-record.js';

import { registerSetupDomain, registerSetupHandler, runSetupHeadless } from './setup-shared/index.js';

function readDefaultModelValue(cfg: Config): unknown {
  return cfg.agents?.defaults?.model ?? null;
}

function parseSetModelFields(fields: Record<string, unknown>): {
  modelRef: string | null;
  patch: Parameters<typeof applyAgentDefaultModelPatch>[1] | null;
  errors: Array<{ path?: string; message: string }>;
} {
  const errors: Array<{ path?: string; message: string }> = [];

  if (fields.model === undefined) {
    errors.push({ path: 'model', message: 'model is required (string or { primary, fallbacks? })' });
    return { modelRef: null, patch: null, errors };
  }

  let modelRef: string | null = null;
  let patch: Parameters<typeof applyAgentDefaultModelPatch>[1];

  if (typeof fields.model === 'string') {
    modelRef = fields.model.trim();
    if (!modelRef) {
      errors.push({ path: 'model', message: 'model string cannot be empty' });
      return { modelRef: null, patch: null, errors };
    }
    const fallbacks = Array.isArray(fields.fallbacks)
      ? fields.fallbacks.filter((f): f is string => typeof f === 'string')
      : undefined;
    patch = { model: modelRef, fallbacks };
  } else if (isRecord(fields.model) && typeof fields.model.primary === 'string') {
    modelRef = fields.model.primary.trim();
    if (!modelRef) {
      errors.push({ path: 'model.primary', message: 'model.primary cannot be empty' });
      return { modelRef: null, patch: null, errors };
    }
    const fallbacks = Array.isArray(fields.model.fallbacks)
      ? fields.model.fallbacks.filter((f): f is string => typeof f === 'string')
      : undefined;
    patch = { model: { primary: modelRef, fallbacks } };
  } else {
    errors.push({
      path: 'model',
      message: 'model must be a provider/model string or { primary, fallbacks? }',
    });
    return { modelRef: null, patch: null, errors };
  }

  return { modelRef, patch, errors };
}

registerSetupHandler({
  domain: 'agents',
  action: 'set-model',
  handler: async ({ configPath, fields, options }) => {
    const { modelRef, patch, errors: parseErrors } = parseSetModelFields(fields);
    if (!patch || !modelRef || parseErrors.length > 0) {
      return {
        ok: false,
        action: 'set',
        domain: 'agents',
        changedPaths: [],
        dryRun: options.dryRun,
        errors: parseErrors,
      };
    }

    try {
      resolveModel(modelRef);
    } catch (error) {
      return {
        ok: false,
        action: 'set',
        domain: 'agents',
        changedPaths: [],
        dryRun: options.dryRun,
        errors: [{ path: 'model', message: (error as Error).message }],
      };
    }

    return runSetupHeadless({
      configPath,
      options,
      mutator: {
        domain: 'agents',
        action: 'set',
        mutate: (cfg) => applyAgentDefaultModelPatch(cfg, patch),
        resultValue: (cfg) => ({
          model: readDefaultModelValue(cfg),
          resolved: buildAgentDefaultModelField(patch),
        }),
        notes: () => [
          'Only agents.defaults.model was updated — use Settings agent-defaults tabs for browser/tools/memory.',
        ],
      },
    });
  },
});

registerSetupDomain({
  domain: 'agents',
  description: 'Default agent runtime (narrow setup surface — model ref only).',
  docs: 'https://xopcai.github.io/xopc/configuration',
  storage: 'cfg.agents.defaults.model in ~/.xopc/xopc.json',
  actions: [
    {
      name: 'set-model',
      cli: 'POST /api/setup/agents/set-model',
      description: 'Set default chat model (primary + optional fallbacks). Does not change other agent defaults.',
      fields: ['model', 'fallbacks'],
    },
  ],
  fields: {
    model: {
      type: 'string',
      description: 'Model ref (provider/model) or { primary, fallbacks? }.',
      required: true,
    },
    fallbacks: {
      type: 'string',
      description: 'Optional fallback model refs when model is a plain string.',
    },
  },
});

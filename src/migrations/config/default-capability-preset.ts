import { existsSync, readFileSync } from 'node:fs';

import {
  CapabilityPresetSchema,
  DEFAULT_CAPABILITY_PRESET_ID,
  type CapabilityPreset,
} from '../../agent-manifest/schema.js';
import { ConfigSchema, type Config } from '../../config/schema.js';
import type { Migration, MigrationContext, MigrationPlanItem } from '../types.js';

export const DEFAULT_CAPABILITY_PRESET_MIGRATION_ID = '2026-07-ensure-default-capability-preset';

export function createDefaultCapabilityPreset(): CapabilityPreset {
  return {
    id: DEFAULT_CAPABILITY_PRESET_ID,
    name: 'Global defaults',
    description: 'Default capabilities inherited by every agent.',
    version: 1,
    models: {
      defaultRole: 'deep',
      roles: {},
    },
  };
}

export function ensureDefaultCapabilityPresetInitialized(config: Config): { config: Config; changed: boolean } {
  const agents = config.agents;
  const capabilityPresets = { ...(agents.capabilityPresets ?? {}) };
  let changed = false;

  if (!capabilityPresets[DEFAULT_CAPABILITY_PRESET_ID]) {
    capabilityPresets[DEFAULT_CAPABILITY_PRESET_ID] = createDefaultCapabilityPreset();
    changed = true;
  }

  const defaultPreset = agents.defaultPreset?.trim() || DEFAULT_CAPABILITY_PRESET_ID;
  if (defaultPreset !== agents.defaultPreset) {
    changed = true;
  }

  if (!changed) return { config, changed: false };

  return {
    config: ConfigSchema.parse({
      ...config,
      agents: {
        ...agents,
        defaultPreset,
        capabilityPresets,
      },
    }),
    changed: true,
  };
}

function planned(message: string, details?: Record<string, unknown>): MigrationPlanItem {
  return {
    id: DEFAULT_CAPABILITY_PRESET_MIGRATION_ID,
    title: 'Initialize global default capability preset',
    kind: 'config',
    safety: 'auto',
    status: 'planned',
    message,
    details,
  };
}

function conflict(message: string, details?: Record<string, unknown>): MigrationPlanItem {
  return {
    id: DEFAULT_CAPABILITY_PRESET_MIGRATION_ID,
    title: 'Initialize global default capability preset',
    kind: 'config',
    safety: 'manual',
    status: 'conflict',
    message,
    details,
  };
}

function readRawConfigObject(configPath: string): Record<string, unknown> | null {
  if (!existsSync(configPath)) return null;
  const raw = readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Config root must be an object');
  }
  return parsed as Record<string, unknown>;
}

export const defaultCapabilityPresetMigration: Migration = {
  id: DEFAULT_CAPABILITY_PRESET_MIGRATION_ID,
  kind: 'config',
  safety: 'auto',

  detect(ctx: MigrationContext): MigrationPlanItem | null {
    const raw = readRawConfigObject(ctx.configPath);
    if (!raw) return null;

    const rawAgents = raw.agents;
    if (rawAgents !== undefined && (rawAgents === null || typeof rawAgents !== 'object' || Array.isArray(rawAgents))) {
      return conflict('agents config is not an object; cannot initialize global defaults automatically.');
    }

    const agents = (rawAgents ?? {}) as Record<string, unknown>;
    const rawPresets = agents.capabilityPresets;
    if (rawPresets !== undefined && (rawPresets === null || typeof rawPresets !== 'object' || Array.isArray(rawPresets))) {
      return conflict('agents.capabilityPresets is not an object; cannot initialize global defaults automatically.');
    }

    const presets = (rawPresets ?? {}) as Record<string, unknown>;
    const existingDefault = presets[DEFAULT_CAPABILITY_PRESET_ID];
    if (existingDefault !== undefined) {
      const parsedPreset = CapabilityPresetSchema.safeParse(existingDefault);
      if (!parsedPreset.success) {
        return conflict('Existing default capability preset is invalid; please repair it manually.', {
          issues: parsedPreset.error.issues.slice(0, 5).map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        });
      }
    }

    const needsDefaultPresetPointer = typeof agents.defaultPreset !== 'string' || agents.defaultPreset.trim().length === 0;
    const needsDefaultPresetObject = existingDefault === undefined;
    if (!needsDefaultPresetPointer && !needsDefaultPresetObject) return null;

    return planned('Global default capability preset is missing and will be initialized.', {
      addDefaultPresetPointer: needsDefaultPresetPointer,
      addDefaultPresetObject: needsDefaultPresetObject,
    });
  },

  apply(ctx: MigrationContext): MigrationPlanItem {
    const detected = this.detect(ctx);
    if (!detected) {
      return {
        id: this.id,
        title: 'Initialize global default capability preset',
        kind: 'config',
        safety: 'auto',
        status: 'not_needed',
        message: 'Global default capability preset is already initialized.',
      };
    }
    if (detected.status === 'conflict') return detected;

    const raw = readRawConfigObject(ctx.configPath);
    const parsed = ConfigSchema.parse(raw ?? undefined);
    const ensured = ensureDefaultCapabilityPresetInitialized(parsed);
    if (!ensured.changed) {
      return { ...detected, status: 'not_needed', message: 'Global default capability preset is already initialized.' };
    }

    return {
      ...detected,
      status: 'applied',
      message: 'Initialized global default capability preset.',
      details: { ...detected.details, config: ensured.config },
    };
  },
};

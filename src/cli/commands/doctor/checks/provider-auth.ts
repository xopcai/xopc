import { existsSync } from 'node:fs';

import { loadConfig } from '../../../../config/loader.js';
import type { Config } from '../../../../config/schema.js';
import { parseModelRef, getAgentDefaultModelRef } from '../../../../config/schema.js';
import { getApiKeyFromEnv, PROVIDER_ENV_MAP } from '../../../../providers/env-keys.js';
import type { CheckResult, DoctorContext } from '../types.js';

function collectProviderIdsFromConfig(cfg: Config): Set<string> {
  const ids = new Set<string>();

  const addRef = (ref: string | undefined) => {
    if (!ref?.trim()) return;
    const parsed = parseModelRef(ref.trim());
    if (parsed) ids.add(parsed.provider.toLowerCase());
  };

  addRef(getAgentDefaultModelRef(cfg));

  const addRoles = (roles: Record<string, { model?: string }> | undefined) => {
    for (const role of Object.values(roles ?? {})) {
      addRef(role.model);
    }
  };

  const list = cfg.agents?.list;
  if (Array.isArray(list)) {
    for (const e of list) {
      addRoles(e?.models?.roles);
    }
  }

  return ids;
}

function anyProviderEnvPresent(): boolean {
  for (const vars of Object.values(PROVIDER_ENV_MAP)) {
    for (const v of vars) {
      if (process.env[v]?.trim()) return true;
    }
  }
  for (const [k, val] of Object.entries(process.env)) {
    if (!val?.trim()) continue;
    if (k.endsWith('_API_KEY') || k.endsWith('_TOKEN')) return true;
  }
  return false;
}

export async function checkProviderAuth(ctx: DoctorContext): Promise<CheckResult> {
  if (!existsSync(ctx.configPath)) {
    return {
      id: 'provider-auth',
      label: 'Provider auth',
      status: 'skip',
      message: 'No config file; skipped.',
      hints: [],
    };
  }

  let cfg: Config;
  try {
    cfg = loadConfig(ctx.configPath);
  } catch {
    return {
      id: 'provider-auth',
      label: 'Provider auth',
      status: 'skip',
      message: 'Config could not be loaded; skipped.',
      hints: [],
    };
  }

  const fromConfig = collectProviderIdsFromConfig(cfg);
  const checkIds = fromConfig.size > 0 ? [...fromConfig] : Object.keys(PROVIDER_ENV_MAP);

  for (const id of checkIds) {
    const key = getApiKeyFromEnv(id);
    if (key?.trim()) {
      return {
        id: 'provider-auth',
        label: 'Provider auth',
        status: 'pass',
        message: 'At least one LLM provider API key is available.',
        hints: [],
      };
    }
  }

  if (anyProviderEnvPresent()) {
    return {
      id: 'provider-auth',
      label: 'Provider auth',
      status: 'pass',
      message: 'Environment contains provider credentials.',
      hints: [],
    };
  }

  return {
    id: 'provider-auth',
    label: 'Provider auth',
    status: 'warn',
    message: 'No API keys detected for configured providers.',
    hints: ['Set keys via: xopc auth set <provider> <key>', 'Or export the provider env vars from the pi-ai docs.'],
  };
}

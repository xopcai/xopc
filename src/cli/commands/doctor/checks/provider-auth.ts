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

  const raw = cfg.agents?.defaults?.model;
  if (raw && typeof raw === 'object' && 'fallbacks' in raw && Array.isArray(raw.fallbacks)) {
    for (const f of raw.fallbacks) {
      addRef(typeof f === 'string' ? f : undefined);
    }
  }

  const list = cfg.agents?.list;
  if (Array.isArray(list)) {
    for (const e of list) {
      const m = e?.model;
      if (typeof m === 'string') addRef(m);
      else if (m && typeof m === 'object' && 'primary' in m) {
        addRef(typeof m.primary === 'string' ? m.primary : undefined);
        const fb = (m as { fallbacks?: string[] }).fallbacks;
        if (Array.isArray(fb)) {
          for (const f of fb) addRef(f);
        }
      }
    }
  }

  const img = cfg.agents?.defaults?.imageModel;
  if (typeof img === 'string') addRef(img);
  else if (img && typeof img === 'object' && 'primary' in img) {
    addRef(typeof img.primary === 'string' ? img.primary : undefined);
  }

  const ss = cfg.agents?.defaults?.sessionSearch?.summaryModel;
  if (typeof ss === 'string') addRef(ss);

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

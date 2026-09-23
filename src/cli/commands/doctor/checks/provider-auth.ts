import { existsSync } from 'node:fs';

import { CredentialResolver } from '../../../../auth/credentials.js';
import { AgentCatalogRepository } from '../../../../agent-catalog/repository.js';
import { getModelOAuthProviderIds } from '../../../../auth/oauth/registry.js';
import { getDefaultAgentId } from '../../../../routing/resolve-route.js';
import { loadConfig } from '../../../../config/loader.js';
import type { Config } from '../../../../config/schema.js';
import { parseModelRef, getAgentDefaultModelRef } from '../../../../config/schema.js';
import { PROVIDER_ENV_MAP } from '../../../../providers/env-keys.js';
import type { CheckResult, DoctorContext } from '../types.js';

function collectProviderIdsFromConfig(): Set<string> {
  const ids = new Set<string>();

  const addRef = (ref: string | undefined) => {
    if (!ref?.trim()) return;
    const parsed = parseModelRef(ref.trim());
    if (parsed) ids.add(parsed.provider.toLowerCase());
  };

  addRef(getAgentDefaultModelRef());

  const addRoutes = (routes: Record<string, { primary?: string } | undefined> | undefined) => {
    for (const route of Object.values(routes ?? {})) {
      addRef(route?.primary);
    }
  };

  const catalog = new AgentCatalogRepository().snapshot();
  addRef(catalog.defaults.models.chat.primary);
  addRoutes(catalog.defaults.models.intents);
  addRef(catalog.defaults.models.imageUnderstanding?.primary);
  addRef(catalog.defaults.models.imageGeneration?.primary);

  const list = catalog.agents;
  if (Array.isArray(list)) {
    for (const e of list) {
      addRef(e?.models?.chat?.primary);
      addRoutes(e?.models?.intents);
      addRef(e?.models?.imageUnderstanding?.primary);
      addRef(e?.models?.imageGeneration?.primary);
    }
  }

  return ids;
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

  const credentials = new CredentialResolver({
    stateDir: ctx.stateDir,
    agentId: getDefaultAgentId(),
    appConfig: cfg,
  });
  const profiles = await credentials.listProfiles();
  const checkIds = new Set([
    ...collectProviderIdsFromConfig(),
    ...Object.keys(PROVIDER_ENV_MAP),
    ...getModelOAuthProviderIds(),
    ...profiles.map((profile) => profile.provider),
  ]);

  for (const id of checkIds) {
    if (await credentials.hasCredentials(id)) {
      return {
        id: 'provider-auth',
        label: 'Provider auth',
        status: 'pass',
        message: 'At least one LLM provider credential is available.',
        hints: [],
      };
    }
  }

  return {
    id: 'provider-auth',
    label: 'Provider auth',
    status: 'warn',
    message: 'No API keys detected for configured providers.',
    hints: ['Set keys via: xopc auth set <provider> <key>', 'Or export the provider env vars from the pi-ai docs.'],
  };
}

import { validatePhoneModelChange } from '../phone/model-adapter.js';
import { isDeepStrictEqual } from 'node:util';

import { AgentDefaultsSchema, type AgentDefaults } from '../agent-config/index.js';
import { AgentCatalogRepository } from '../agent-catalog/repository.js';
import { AgentCatalogService } from '../agent-catalog/service.js';
import { validateComputerModelChange } from '../computer/model-config.js';
import {
  GATEWAY_BUILTIN_TOOLS,
  type GatewayBuiltinToolSummary,
} from './agent-builtin-tools.js';

export type GlobalDefaultsPayload = {
  defaults: AgentDefaults;
  builtinTools: GatewayBuiltinToolSummary[];
};

export type UpdateGlobalDefaultsBody = {
  defaults: AgentDefaults;
  scope?: 'models' | 'agent';
  expectedModels?: AgentDefaults['models'];
};

export type GlobalDefaultsAdminResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: 400 | 404 | 409 | 500 };

export function listGlobalDefaults(): GlobalDefaultsPayload {
  return {
    defaults: structuredClone(new AgentCatalogRepository().getSettings().defaults),
    builtinTools: GATEWAY_BUILTIN_TOOLS.map((tool) => ({
      id: tool.id,
      description: { ...tool.description },
    })),
  };
}

export function prepareUpdateGlobalDefaults(
  body: UpdateGlobalDefaultsBody,
): GlobalDefaultsAdminResult<{ defaults: AgentDefaults; changed: boolean }> {
  const current = new AgentCatalogRepository().getSettings().defaults;
  if (body.expectedModels && !isDeepStrictEqual(current.models, body.expectedModels)) {
    return { ok: false, error: 'Model settings changed. Refresh before retrying.', status: 409 };
  }
  const requested = body.scope === 'models' ? { ...current, models: body.defaults.models }
    : body.scope === 'agent' ? { ...body.defaults, models: current.models } : body.defaults;
  const parsed = AgentDefaultsSchema.safeParse(requested);
  if (!parsed.success) {
    return { ok: false, error: `defaults ${parsed.error.issues[0]?.message ?? 'is invalid'}`, status: 400 };
  }
  try {
    validatePhoneModelChange(parsed.data.models.phoneUse, current.models.phoneUse);
    validateComputerModelChange(parsed.data.models.computerUse, current.models.computerUse);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), status: 400 };
  }
  return {
    ok: true,
    data: {
      changed: !isDeepStrictEqual(current, parsed.data),
      defaults: parsed.data,
    },
  };
}

export function updateGlobalDefaults(
  body: UpdateGlobalDefaultsBody,
): GlobalDefaultsAdminResult<{ changed: boolean }> {
  const prepared = prepareUpdateGlobalDefaults(body);
  if (!prepared.ok) return prepared;
  if (prepared.data.changed) new AgentCatalogService().updateDefaults(prepared.data.defaults);
  return { ok: true, data: { changed: prepared.data.changed } };
}

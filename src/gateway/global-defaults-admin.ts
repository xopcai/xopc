import { AgentDefaultsSchema, type AgentDefaults } from '../agent-config/index.js';
import type { Config } from '../config/schema.js';
import {
  GATEWAY_BUILTIN_TOOLS,
  type GatewayBuiltinToolSummary,
} from './agent-builtin-tools.js';

export type GlobalDefaultsPayload = {
  defaults: AgentDefaults;
  builtinTools: GatewayBuiltinToolSummary[];
};

export type UpdateGlobalDefaultsBody = { defaults: AgentDefaults };

export type GlobalDefaultsAdminResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: 400 | 404 | 500 };

export function listGlobalDefaults(cfg: Config): GlobalDefaultsPayload {
  return {
    defaults: structuredClone(cfg.agents.defaults),
    builtinTools: GATEWAY_BUILTIN_TOOLS.map((tool) => ({
      id: tool.id,
      description: { ...tool.description },
    })),
  };
}

export function prepareUpdateGlobalDefaults(
  cfg: Config,
  body: UpdateGlobalDefaultsBody,
): GlobalDefaultsAdminResult<{ nextConfig: Config }> {
  const parsed = AgentDefaultsSchema.safeParse(body.defaults);
  if (!parsed.success) {
    return { ok: false, error: `defaults ${parsed.error.issues[0]?.message ?? 'is invalid'}`, status: 400 };
  }
  return {
    ok: true,
    data: {
      nextConfig: {
        ...cfg,
        agents: {
          ...cfg.agents,
          defaults: parsed.data,
        },
      },
    },
  };
}

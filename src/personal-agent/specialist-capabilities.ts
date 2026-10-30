import type { EffectiveAgentConfig } from '../agent-config/index.js';
import type { Config } from '../config/schema.js';
import { isProviderConfiguredSync, resolveModel } from '../providers/index.js';

const DISCOVERY_TOOLS = [
  'web_search', 'web_fetch', 'browser_use', 'read_file', 'write_file', 'exec_command',
  'apply_patch', 'list_dir', 'grep', 'find', 'publish_artifacts', 'skill_view',
  'image', 'image_generate', 'read_media', 'automation', 'xopc_use',
  'tool_search', 'xopc_tool_describe', 'xopc_tool_execute', 'computer_use', 'send_message', 'text_to_speech',
] as const;

/** Legacy allowlists keep their discovery permission; explicit denies still win. */
export function allowsPersonalAgentTool(config: EffectiveAgentConfig, name: string): boolean {
  const alias = name === 'tool_search' ? 'xopc_tool_search' : name;
  return config.tools[name]?.mode !== 'deny' && config.tools[alias]?.mode !== 'deny'
    && (!config.toolAllowlist || config.toolAllowlist.includes(name) || config.toolAllowlist.includes(alias));
}

export function getAvailablePersonalAgentTools(config: EffectiveAgentConfig, deps: { getConfig?: () => Config | undefined }): string[] {
  const allowlist = config.toolAllowlist?.map(name => name === 'xopc_tool_search' ? 'tool_search' : name);
  const names = allowlist ? [...new Set([...DISCOVERY_TOOLS, ...allowlist])] : DISCOVERY_TOOLS;
  return names.filter(name => (name !== 'browser_use' || deps.getConfig?.()?.browser?.enabled !== false)
    && allowsPersonalAgentTool(config, name));
}

export function personalAgentModelAvailability(config: EffectiveAgentConfig): { available: boolean; reason?: string } {
  for (const ref of [config.models.chat.primary, ...config.models.chat.fallbacks]) {
    try {
      const model = resolveModel(ref);
      if (isProviderConfiguredSync(model.provider)) return { available: true };
    } catch { /* Try the next configured model. */ }
  }
  return { available: false, reason: 'No configured chat model resolves to an available provider' };
}


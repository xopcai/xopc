import type { EffectiveAgentConfig } from '../agent-config/index.js';
import type { Config } from '../config/schema.js';
import { isProviderConfiguredSync, resolveModel } from '../providers/index.js';

const DISCOVERY_TOOLS = [
  'web_search', 'web_fetch', 'browser_use', 'read_file', 'write_file', 'exec_command',
  'image', 'image_generate', 'read_media', 'automation', 'workflow', 'xopc_use',
  'xopc_tool_search', 'xopc_tool_describe', 'xopc_tool_execute', 'computer_use', 'send_message', 'text_to_speech',
] as const;

export function getAvailablePersonalAgentTools(config: EffectiveAgentConfig, deps: { getConfig?: () => Config | undefined }): string[] {
  const names = config.toolAllowlist ? [...new Set([...DISCOVERY_TOOLS, ...config.toolAllowlist])] : DISCOVERY_TOOLS;
  return names.filter(name => (name !== 'browser_use' || deps.getConfig?.()?.browser?.enabled !== false)
    && (!config.toolAllowlist || config.toolAllowlist.includes(name)) && config.tools[name]?.mode !== 'deny');
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


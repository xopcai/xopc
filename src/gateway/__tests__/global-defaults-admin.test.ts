import { describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { listGlobalDefaults, prepareUpdateGlobalDefaults } from '../global-defaults-admin.js';

describe('global defaults admin', () => {
  it('returns one bilingual description for every built-in tool', () => {
    const payload = listGlobalDefaults(ConfigSchema.parse({}));
    expect(payload.builtinTools.length).toBeGreaterThan(0);
    expect(new Set(payload.builtinTools.map((tool) => tool.id)).size).toBe(payload.builtinTools.length);
    expect(payload.builtinTools.every((tool) => tool.description.en && tool.description.zh)).toBe(true);
  });

  it('replaces the single validated global defaults object', () => {
    const config = ConfigSchema.parse({});
    const result = prepareUpdateGlobalDefaults(config, {
      defaults: {
        ...config.agents.defaults,
        models: {
          ...config.agents.defaults.models,
          chat: { primary: 'openai/gpt-5', fallbacks: ['anthropic/claude-sonnet-4-5'] },
        },
        tools: { exec_command: { mode: 'ask' } },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.nextConfig.agents.defaults.models.chat.primary).toBe('openai/gpt-5');
    expect(result.data.nextConfig.agents.defaults.tools.exec_command?.mode).toBe('ask');
  });
});

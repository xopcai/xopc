import { describe, expect, it, vi } from 'vitest';

import {
  createSkillInstallTool,
  type MarketplaceSkillInstallToolOptions,
} from '../skill-install-tool.js';

function textPayload(result: Awaited<ReturnType<ReturnType<typeof createSkillInstallTool>['execute']>>) {
  return result.content[0]?.type === 'text' ? result.content[0].text : '';
}

describe('skill_install', () => {
  it('installs an exact marketplace reference when the user requested a marketplace skill', async () => {
    const installSkillFromMarketplace = vi.fn(async () => ({
      skillId: 'hyperframes',
      path: '/workspace/.xopc/skills/hyperframes',
      provider: 'clawhub' as const,
      name: 'heygen-com/hyperframes',
      version: '1.0.0',
      target: 'global' as const,
    }));
    const tool = createSkillInstallTool({
      installSkillFromMarketplace,
      getSessionKey: () => 'agent:main:webchat:test',
    });

    const result = await tool.execute('call-1', {
      provider: 'clawhub',
      name: 'heygen-com/hyperframes',
    });

    expect(installSkillFromMarketplace).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'clawhub',
      name: 'heygen-com/hyperframes',
      sessionKey: 'agent:main:webchat:test',
      target: 'global',
    }));
    expect(textPayload(result)).toContain('Installed skill "hyperframes" from clawhub.');
  });

  it('keeps explicit source installation available', async () => {
    const installSkillFromSource = vi.fn(async () => ({
      skillId: 'demo',
      path: '/workspace/.xopc/skills/demo',
      source: 'https://github.com/example/demo',
      kind: 'git' as const,
      contentHash: '0123456789abcdef',
      target: 'global' as const,
    }));
    const tool = createSkillInstallTool({ installSkillFromSource });

    const result = await tool.execute('call-2', {
      source: 'https://github.com/example/demo',
      strictScan: true,
    });

    expect(installSkillFromSource).toHaveBeenCalledWith(expect.objectContaining({
      source: 'https://github.com/example/demo',
      strictScan: true,
      target: 'global',
    }));
    expect(textPayload(result)).toContain('Installed skill "demo".');
  });

  it('uses workspace only when explicitly requested', async () => {
    const installSkillFromMarketplace = vi.fn(async (opts: MarketplaceSkillInstallToolOptions) => ({
      skillId: 'demo',
      path: '/workspace/.xopc/skills/demo',
      provider: opts.provider,
      name: opts.name,
      target: opts.target,
    }));
    const tool = createSkillInstallTool({ installSkillFromMarketplace });

    await tool.execute('call-3', {
      provider: 'store',
      name: 'demo',
      target: 'workspace',
    });

    expect(installSkillFromMarketplace).toHaveBeenCalledWith(expect.objectContaining({
      target: 'workspace',
    }));
  });
});

/**
 * Feishu interactive onboarding (CLI onboard) — {@link ChannelOnboardAdapter}.
 *
 * This configures the single-account layout under `channels.feishu.*`.
 */

import { confirm, input, select } from '@inquirer/prompts';

import type { Config } from '@xopcai/xopc/config/schema.js';
import type { ChannelOnboardAdapter } from '@xopcai/xopc/channels/plugins/types.adapters.js';

type DmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled';
type GroupPolicy = 'open' | 'disabled' | 'allowlist';
type Domain = 'feishu' | 'lark';
type RenderMode = 'auto' | 'raw' | 'card';

function isFeishuConfigured(config: Config): boolean {
  const feishu = config.channels?.feishu as Record<string, unknown> | undefined;
  if (!feishu) return false;
  const appId = typeof feishu.appId === 'string' ? feishu.appId.trim() : '';
  const appSecret = typeof feishu.appSecret === 'string' ? feishu.appSecret.trim() : '';
  const enabled = feishu.enabled === true;
  return enabled && Boolean(appId && appSecret);
}

function parseAllowlistRaw(raw: string): Array<string | number> {
  if (!raw.trim()) return [];
  const entries = raw
    .split(/[,\s\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return entries.map((e) => {
    const num = parseInt(e, 10);
    return !isNaN(num) && String(num) === e ? num : e;
  });
}

async function configureFeishu(config: Config): Promise<Config> {
  console.log(`\n${'='.repeat(50)}`);
  console.log('📱 Feishu / Lark setup');
  console.log(`${'='.repeat(50)}\n`);

  const existing = config.channels?.feishu as Record<string, unknown> | undefined;
  const existingAppId = typeof existing?.appId === 'string' ? existing.appId : '';
  const existingDomain = typeof existing?.domain === 'string' ? existing.domain : '';

  if (existing?.enabled === true && existingAppId) {
    const keep = await confirm({
      message: 'A Feishu config already exists. Reconfigure it?',
      default: false,
    });
    if (!keep) return config;
  }

  console.log('📝 Feishu app credentials (from Feishu Open Platform developer console):\n');

  const appId = (await input({
    message: 'App ID (cli_xxx):',
    default: existingAppId || undefined,
    validate: (v) => v.trim().length > 0 || 'App ID cannot be empty',
  })).trim();

  const appSecret = (await input({
    message: 'App Secret:',
    validate: (v) => v.trim().length > 0 || 'App Secret cannot be empty',
  })).trim();

  const domain = await select<Domain>({
    message: 'Feishu/Lark domain:',
    choices: [
      { value: 'feishu', name: 'feishu (open.feishu.cn)', description: 'China / Feishu' },
      { value: 'lark', name: 'lark (open.larksuite.com)', description: 'International / Lark' },
    ],
    default: existingDomain === 'lark' ? 'lark' : 'feishu',
  });

  const dmPolicy = await select<DmPolicy>({
    message: 'DM (private chat) policy:',
    choices: [
      { value: 'pairing', name: 'pairing  [recommended]', description: 'New users must /pair before chatting' },
      { value: 'allowlist', name: 'allowlist', description: 'Only allowlisted users can DM' },
      { value: 'open', name: 'open', description: 'Anyone can DM (not recommended)' },
      { value: 'disabled', name: 'disabled', description: 'Disable DMs' },
    ],
    default: 'pairing',
  });

  let allowFrom: Array<string | number> | undefined;
  if (dmPolicy === 'allowlist') {
    const raw = await input({
      message: 'Allowed user open_id / union_id / numeric ids (comma-separated):',
      default: '',
    });
    allowFrom = parseAllowlistRaw(raw);
  }

  const groupPolicy = await select<GroupPolicy>({
    message: 'Group chat policy:',
    choices: [
      { value: 'allowlist', name: 'allowlist  [recommended]', description: 'Only allowlisted groups can use the bot' },
      { value: 'open', name: 'open', description: 'All groups allowed' },
      { value: 'disabled', name: 'disabled', description: 'Disable groups' },
    ],
    default: 'allowlist',
  });

  let groupAllowFrom: Array<string | number> | undefined;
  if (groupPolicy === 'allowlist') {
    const raw = await input({
      message: 'Allowed group chat IDs (comma-separated, e.g. oc_xxx):',
      default: '',
    });
    groupAllowFrom = parseAllowlistRaw(raw);
  }

  const requireMention = await confirm({
    message: 'Require @mention in groups?',
    default: true,
  });

  const renderMode = await select<RenderMode>({
    message: 'Default render mode:',
    choices: [
      { value: 'auto', name: 'auto', description: 'Let xopc decide (default)' },
      { value: 'raw', name: 'raw', description: 'Send plain text only' },
      { value: 'card', name: 'card', description: 'Prefer interactive cards (CardKit streaming)' },
    ],
    default: 'auto',
  });

  const streaming = await confirm({
    message: 'Enable streaming updates (Thinking… + incremental output)?',
    default: true,
  });

  const nextFeishu: Record<string, unknown> = {
    ...(existing ?? {}),
    enabled: true,
    appId,
    appSecret,
    domain,
    connectionMode: 'websocket',
    dmPolicy,
    groupPolicy,
    allowFrom: allowFrom ?? (existing?.allowFrom as any) ?? [],
    groupAllowFrom: groupAllowFrom ?? (existing?.groupAllowFrom as any) ?? [],
    requireMention,
    renderMode,
    streaming,
    historyLimit: typeof existing?.historyLimit === 'number' ? existing.historyLimit : 50,
    textChunkLimit: typeof existing?.textChunkLimit === 'number' ? existing.textChunkLimit : 4000,
  };

  const newConfig: Config = {
    ...config,
    channels: {
      ...config.channels,
      feishu: nextFeishu,
    },
  };

  console.log('\n✅ Feishu configuration complete\n');
  return newConfig;
}

export const feishuOnboardAdapter: ChannelOnboardAdapter = {
  isConfigured: isFeishuConfigured,
  configure: configureFeishu,
};


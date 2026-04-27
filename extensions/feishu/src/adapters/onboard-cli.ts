/**
 * Feishu interactive onboarding (CLI onboard) — {@link ChannelOnboardAdapter}.
 *
 * This configures the single-account layout under `channels.feishu.*`.
 */

import { confirm, input, select } from '@inquirer/prompts';

import type { Config } from '@xopcai/xopc/config/schema.js';
import type { ChannelOnboardAdapter } from '@xopcai/xopc/channels/plugins/types.adapters.js';

import {
  initAppRegistration,
  beginAppRegistration,
  pollAppRegistration,
  printQrCode,
  type FeishuDomain,
} from '../auth/app-registration.js';

type DmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled';
type GroupPolicy = 'open' | 'disabled' | 'allowlist';
type RenderMode = 'auto' | 'raw' | 'card';
type ConnectionMode = 'websocket' | 'webhook';
type ReactionNotifications = 'off' | 'own' | 'all';

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

  const initialDomain = await select<FeishuDomain>({
    message: 'Feishu/Lark domain:',
    choices: [
      { value: 'feishu', name: 'feishu (open.feishu.cn)', description: 'China / Feishu' },
      { value: 'lark', name: 'lark (open.larksuite.com)', description: 'International / Lark' },
    ],
    default: existingDomain === 'lark' ? 'lark' : 'feishu',
  });

  const canScanToCreate = await initAppRegistration(initialDomain);
  const useScanToCreate = canScanToCreate
    ? await confirm({
        message: 'Create an app by scanning a QR code (recommended)?',
        default: true,
      })
    : false;

  let appId = '';
  let appSecret = '';
  let domain: FeishuDomain = initialDomain;
  let ownerOpenId: string | undefined;

  if (useScanToCreate) {
    console.log('\nScan this QR code with Feishu/Lark to create an app:\n');
    const begin = await beginAppRegistration(initialDomain);
    await printQrCode(begin.qrUrl);
    console.log('\nWaiting for confirmation...\n');
    const outcome = await pollAppRegistration({
      deviceCode: begin.deviceCode,
      intervalSec: begin.intervalSec,
      expireInSec: begin.expireInSec,
      initialDomain,
    });
    if (outcome.status !== 'success') {
      console.log('Scan-to-create did not complete. Falling back to manual input.\n');
    } else {
      appId = outcome.result.appId;
      appSecret = outcome.result.appSecret;
      domain = outcome.result.domain;
      ownerOpenId = outcome.result.openId;
      console.log(`✅ App created. Domain detected as "${domain}".\n`);
    }
  }

  if (!appId || !appSecret) {
    console.log('📝 Feishu app credentials (from Feishu Open Platform developer console):\n');

    appId = (await input({
      message: 'App ID (cli_xxx):',
      default: existingAppId || undefined,
      validate: (v) => v.trim().length > 0 || 'App ID cannot be empty',
    })).trim();

    appSecret = (await input({
      message: 'App Secret:',
      validate: (v) => v.trim().length > 0 || 'App Secret cannot be empty',
    })).trim();

    domain = initialDomain;
  }

  const connectionMode = await select<ConnectionMode>({
    message: 'Connection mode:',
    choices: [
      { value: 'websocket', name: 'websocket  [recommended]', description: 'Socket Mode (persistent connection)' },
      { value: 'webhook', name: 'webhook', description: 'Local HTTP server receives events' },
    ],
    default: 'websocket',
  });

  let verificationToken: string | undefined;
  let encryptKey: string | undefined;
  let webhookHost: string | undefined;
  let webhookPort: number | undefined;
  let webhookPath: string | undefined;
  if (connectionMode === 'webhook') {
    console.log('\n🪝 Webhook secrets (from Feishu event subscription settings):\n');
    verificationToken = (await input({
      message: 'Verification Token:',
      validate: (v) => v.trim().length > 0 || 'Verification Token cannot be empty',
    })).trim();
    encryptKey = (await input({
      message: 'Encrypt Key:',
      validate: (v) => v.trim().length > 0 || 'Encrypt Key cannot be empty',
    })).trim();
    webhookHost = (await input({
      message: 'Webhook host:',
      default: typeof existing?.webhookHost === 'string' ? existing.webhookHost : '127.0.0.1',
    })).trim();
    webhookPort = Number(
      (await input({
        message: 'Webhook port:',
        default: typeof existing?.webhookPort === 'number' ? String(existing.webhookPort) : '3000',
      })).trim(),
    );
    webhookPath = (await input({
      message: 'Webhook path:',
      default: typeof existing?.webhookPath === 'string' ? existing.webhookPath : '/feishu/events',
    })).trim();
  }

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
    const defaultAllow =
      ownerOpenId && (existing?.allowFrom == null || (Array.isArray(existing.allowFrom) && existing.allowFrom.length === 0))
        ? ownerOpenId
        : '';
    const raw = await input({
      message: 'Allowed user open_id / union_id / numeric ids (comma-separated):',
      default: defaultAllow,
    });
    allowFrom = parseAllowlistRaw(raw || defaultAllow);
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
    default: false,
  });

  const reactionNotifications = await select<ReactionNotifications>({
    message: 'Reaction notifications:',
    choices: [
      { value: 'off', name: 'off', description: 'Disable reaction notifications' },
      { value: 'own', name: 'own  [recommended]', description: 'Only notify reactions to bot messages' },
      { value: 'all', name: 'all', description: 'Notify all reactions (noisy)' },
    ],
    default: 'own',
  });

  const enableFeishuTools = await select<'minimal' | 'docs' | 'full'>({
    message: 'Enable Feishu tools (docs/wiki/drive/etc.)?',
    choices: [
      { value: 'minimal', name: 'minimal', description: 'No extra tools (chat only)' },
      { value: 'docs', name: 'docs', description: 'Enable doc/wiki/drive/scopes (common)' },
      { value: 'full', name: 'full', description: 'Enable doc/wiki/drive/bitable/perm/scopes' },
    ],
    default: 'docs',
  });

  const tools =
    enableFeishuTools === 'minimal'
      ? { doc: false, wiki: false, drive: false, perm: false, bitable: false, scopes: true }
      : enableFeishuTools === 'docs'
        ? { doc: true, wiki: true, drive: true, perm: false, bitable: true, scopes: true }
        : { doc: true, wiki: true, drive: true, perm: true, bitable: true, scopes: true };

  const nextFeishu: Record<string, unknown> = {
    ...(existing ?? {}),
    enabled: true,
    appId,
    appSecret,
    domain,
    connectionMode,
    ...(connectionMode === 'webhook'
      ? {
          verificationToken,
          encryptKey,
          webhookHost,
          webhookPort,
          webhookPath,
        }
      : {}),
    dmPolicy,
    groupPolicy,
    allowFrom: allowFrom ?? (existing?.allowFrom as any) ?? [],
    groupAllowFrom: groupAllowFrom ?? (existing?.groupAllowFrom as any) ?? [],
    requireMention,
    renderMode,
    streaming,
    reactionNotifications,
    actions: { reactions: true },
    tools,
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


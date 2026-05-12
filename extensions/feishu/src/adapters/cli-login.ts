/**
 * Feishu CLI Login adapter — implements `ChannelCliLoginAdapter`.
 *
 * Provides `xopc channels login --channel feishu` interactive credential setup.
 * Supports QR scan-to-create and manual credential input.
 */

import fs from 'node:fs';

import { confirm, input, select } from '@inquirer/prompts';

import type { Config } from '@xopcai/xopc/config/schema.js';
import { mergeDistinctSenderIds } from '@xopcai/xopc/channels/pairing/index.js';
import type { ChannelCliLoginAdapter } from '@xopcai/xopc/channels/plugins/types.adapters.js';

import {
  initAppRegistration,
  beginAppRegistration,
  pollAppRegistration,
  printQrCode,
  type FeishuDomain,
} from '../auth/app-registration.js';

type DmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled';
type GroupPolicy = 'open' | 'disabled' | 'allowlist';

function loadConfigFromPath(configPath: string): Config {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw) as Config;
  } catch {
    return {} as Config;
  }
}

function writeConfigToPath(configPath: string, config: Config): void {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

function isFeishuConfigured(config: Config): boolean {
  const feishu = config.channels?.feishu as Record<string, unknown> | undefined;
  if (!feishu) return false;
  const appId = typeof feishu.appId === 'string' ? feishu.appId.trim() : '';
  const appSecret = typeof feishu.appSecret === 'string' ? feishu.appSecret.trim() : '';
  return Boolean(appId && appSecret);
}

function parseAllowlistRaw(raw: string): Array<string | number> {
  if (!raw.trim()) return [];
  return raw
    .split(/[,\s\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const asNumber = parseInt(entry, 10);
      return !isNaN(asNumber) && String(asNumber) === entry ? asNumber : entry;
    });
}

async function acquireCredentials(params: {
  existingAppId: string;
  timeoutMs: number;
}): Promise<{
  appId: string;
  appSecret: string;
  domain: FeishuDomain;
  ownerOpenId?: string;
}> {
  const domain = await select<FeishuDomain>({
    message: 'Feishu/Lark domain:',
    choices: [
      { value: 'feishu', name: 'feishu (open.feishu.cn)', description: 'China / Feishu' },
      { value: 'lark', name: 'lark (open.larksuite.com)', description: 'International / Lark' },
    ],
    default: 'feishu',
  });

  const canScan = await initAppRegistration(domain);
  const useScan = canScan
    ? await confirm({
        message: 'Create an app by scanning a QR code (recommended)?',
        default: true,
      })
    : false;

  if (useScan) {
    console.log('\nScan this QR code with Feishu/Lark to create an app:\n');
    const begin = await beginAppRegistration(domain);
    await printQrCode(begin.qrUrl);
    console.log('\nWaiting for confirmation...\n');

    const expireInSec = Math.min(begin.expireInSec, Math.floor(params.timeoutMs / 1000));
    const outcome = await pollAppRegistration({
      deviceCode: begin.deviceCode,
      intervalSec: begin.intervalSec,
      expireInSec,
      initialDomain: domain,
    });

    if (outcome.status === 'success') {
      console.log(`✅ App created. Domain: "${outcome.result.domain}".\n`);
      return {
        appId: outcome.result.appId,
        appSecret: outcome.result.appSecret,
        domain: outcome.result.domain,
        ownerOpenId: outcome.result.openId,
      };
    }

    const reason =
      outcome.status === 'access_denied'
        ? 'User denied authorization.'
        : outcome.status === 'expired'
          ? 'Session expired.'
          : outcome.status === 'timeout'
            ? 'Scan timed out.'
            : `Error: ${'message' in outcome ? outcome.message : 'unknown'}`;
    console.log(`${reason} Falling back to manual input.\n`);
  }

  console.log('📝 Enter Feishu app credentials (from Feishu Open Platform developer console):\n');

  const appId = (
    await input({
      message: 'App ID (cli_xxx):',
      default: params.existingAppId || undefined,
      validate: (value) => value.trim().length > 0 || 'App ID cannot be empty',
    })
  ).trim();

  const appSecret = (
    await input({
      message: 'App Secret:',
      validate: (value) => value.trim().length > 0 || 'App Secret cannot be empty',
    })
  ).trim();

  return { appId, appSecret, domain };
}

async function promptSecurityPolicies(ownerOpenId?: string): Promise<{
  dmPolicy: DmPolicy;
  groupPolicy: GroupPolicy;
  allowFrom: Array<string | number>;
  groupAllowFrom: Array<string | number>;
  requireMention: boolean;
}> {
  const dmPolicy = await select<DmPolicy>({
    message: 'DM (private chat) policy:',
    choices: [
      { value: 'open', name: 'open  [default]', description: 'Anyone can DM the bot after setup' },
      {
        value: 'pairing',
        name: 'pairing',
        description: 'New users need `xopc channels pairing approve`',
      },
      { value: 'allowlist', name: 'allowlist', description: 'Only allowlisted users' },
      { value: 'disabled', name: 'disabled', description: 'Disable DMs' },
    ],
    default: 'open',
  });

  let allowFrom: Array<string | number> = [];
  if (dmPolicy === 'allowlist') {
    const defaultAllow = ownerOpenId ?? '';
    const raw = await input({
      message: 'Allowed user open_id / union_id (comma-separated):',
      default: defaultAllow,
    });
    allowFrom = parseAllowlistRaw(raw || defaultAllow);
  }

  const groupPolicy = await select<GroupPolicy>({
    message: 'Group chat policy:',
    choices: [
      { value: 'allowlist', name: 'allowlist  [recommended]', description: 'Only allowlisted groups' },
      { value: 'open', name: 'open', description: 'All groups allowed' },
      { value: 'disabled', name: 'disabled', description: 'Disable groups' },
    ],
    default: 'allowlist',
  });

  let groupAllowFrom: Array<string | number> = [];
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

  const extras =
    ownerOpenId?.trim() && (dmPolicy === 'pairing' || dmPolicy === 'allowlist') ? [ownerOpenId.trim()] : [];
  const mergedAllowFrom = mergeDistinctSenderIds(allowFrom, extras);

  return { dmPolicy, groupPolicy, allowFrom: mergedAllowFrom, groupAllowFrom, requireMention };
}

export const feishuCliLoginAdapter: ChannelCliLoginAdapter = {
  async runLogin(params) {
    const { configPath, verbose, timeoutMs = 480_000, accountId, writeConfig = true } = params;

    if (verbose) {
      console.log(`[feishu-login] configPath=${configPath}, timeoutMs=${timeoutMs}`);
    }

    const config = loadConfigFromPath(configPath);
    const existingFeishu = config.channels?.feishu as Record<string, unknown> | undefined;
    const existingAppId = typeof existingFeishu?.appId === 'string' ? existingFeishu.appId : '';
    const alreadyConfigured = isFeishuConfigured(config);

    console.log(`\n${'='.repeat(50)}`);
    console.log('📱 Feishu / Lark login');
    console.log(`${'='.repeat(50)}\n`);

    if (alreadyConfigured) {
      const reconfigure = await confirm({
        message: `Feishu is already configured (App ID: ${existingAppId}). Reconfigure?`,
        default: false,
      });
      if (!reconfigure) {
        console.log('Keeping existing configuration.\n');
        return { ok: true, message: 'Existing configuration kept.', accountId };
      }
    }

    const credentials = await acquireCredentials({
      existingAppId,
      timeoutMs,
    });

    const policies = await promptSecurityPolicies(credentials.ownerOpenId);

    const nextFeishu: Record<string, unknown> = {
      ...(existingFeishu ?? {}),
      enabled: true,
      appId: credentials.appId,
      appSecret: credentials.appSecret,
      domain: credentials.domain,
      connectionMode: (existingFeishu?.connectionMode as string) || 'websocket',
      dmPolicy: policies.dmPolicy,
      groupPolicy: policies.groupPolicy,
      allowFrom: policies.allowFrom,
      groupAllowFrom: policies.groupAllowFrom,
      requireMention: policies.requireMention,
    };

    const nextConfig: Config = {
      ...config,
      channels: {
        ...config.channels,
        feishu: nextFeishu,
      },
    };

    if (writeConfig) {
      writeConfigToPath(configPath, nextConfig);
      console.log(`✅ Feishu configuration saved to ${configPath}\n`);
    } else {
      console.log('✅ Feishu credentials acquired (--credentials-only: config not updated).\n');
    }

    return {
      ok: true,
      message: `Feishu login complete (App ID: ${credentials.appId}).`,
      accountId: accountId ?? undefined,
    };
  },
};

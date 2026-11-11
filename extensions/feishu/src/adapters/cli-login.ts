/**
 * Feishu CLI Login adapter — implements `ChannelCliLoginAdapter`.
 *
 * Provides interactive credential setup for Feishu channel onboarding.
 * Supports QR scan-to-create and manual credential input.
 */

import { confirm, input, password, select } from '@inquirer/prompts';

import { loadConfig, saveConfig } from '@xopcai/xopc/config/loader.js';
import { mergeDistinctSenderIds } from '@xopcai/xopc/channels/pairing/index.js';
import type { ChannelCliLoginAdapter } from '@xopcai/xopc/channels/plugins/types.adapters.js';

import {
  initAppRegistration,
  beginAppRegistration,
  pollAppRegistration,
  printQrCode,
  type FeishuDomain,
} from '../auth/app-registration.js';

import { buildFeishuConfig } from './gateway-setup.js';
import { resolveFeishuAccount } from '../state/accounts.js';
import { ensureFeishuLarkSdk } from '../transport/client/lark-sdk.js';

type DmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled';
type GroupPolicy = 'open' | 'disabled' | 'allowlist';

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
  scanned?: boolean;
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
        scanned: true,
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
    await password({
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
      { value: 'open', name: 'open', description: 'Anyone can DM the bot after setup' },
      {
        value: 'pairing',
        name: 'pairing',
        description: 'New users need `xopc channels pairing approve`',
      },
      { value: 'allowlist', name: 'allowlist', description: 'Only allowlisted users' },
      { value: 'disabled', name: 'disabled', description: 'Disable DMs' },
    ],
    default: ownerOpenId?.trim() ? 'allowlist' : 'pairing',
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

    const config = loadConfig(configPath);
    const target = resolveFeishuAccount(config, accountId);
    const existingAppId = target.appId ?? '';
    const alreadyConfigured = target.configured;

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

    if (writeConfig) await ensureFeishuLarkSdk();
    const base = buildFeishuConfig(config, {
      appId: credentials.appId, appSecret: credentials.appSecret, domain: credentials.domain, openId: credentials.ownerOpenId,
    }, target.accountId);
    const section = base.channels?.feishu as import('../schema/config-schema.js').FeishuConfig;
    const account = section.accounts?.[target.accountId];
    if (!credentials.scanned && account) {
      Object.assign(account, await promptSecurityPolicies(credentials.ownerOpenId));
    }

    if (writeConfig) {
      await saveConfig(base, configPath);
      console.log(`✅ Feishu configuration saved to ${configPath}\n`);
    } else {
      console.log('✅ Feishu credentials acquired (--credentials-only: config not updated).\n');
    }

    return {
      ok: true,
      message: `Feishu authorized. Send a message after starting the Gateway (App ID: ${credentials.appId}).`,
      accountId: target.accountId,
    };
  },
};

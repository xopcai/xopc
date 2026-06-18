/**
 * Weixin interactive onboarding — {@link ChannelOnboardAdapter} (QR scan).
 */

import { confirm } from '@inquirer/prompts';

import type { Config } from '@xopcai/xopc/config/schema.js';
import type { ChannelOnboardAdapter } from '@xopcai/xopc/channels/plugins/types.adapters.js';
import { resolveConfigPath } from '@xopcai/xopc/config/paths.js';

import { resolveWeixinAccount, listWeixinAccountIds } from '../auth/accounts.js';
import { mergeWeixinConfigAfterLogin, runWeixinQrLoginCli } from '../cli/qr-login.js';

export function isWeixinOnboardConfigured(config: Config): boolean {
  const ids = listWeixinAccountIds(config);
  for (const id of ids) {
    try {
      if (resolveWeixinAccount(config, id).configured) return true;
    } catch {
      // Skip invalid ids
    }
  }
  return false;
}

function resolveCliConfigPath(): string {
  return (
    process.env.XOPC_CONFIG_PATH?.trim() ||
    process.env.XOPC_CONFIG?.trim() ||
    resolveConfigPath()
  );
}

async function configureWeixin(config: Config): Promise<Config> {
  console.log(`\n${'='.repeat(50)}`);
  console.log('💬 Weixin (WeChat ilink)');
  console.log(`${'='.repeat(50)}\n`);

  if (isWeixinOnboardConfigured(config)) {
    const rescan = await confirm({
      message: 'Weixin appears configured. Scan QR again to replace login?',
      default: false,
    });
    if (!rescan) {
      console.log('ℹ️  Weixin onboarding skipped.');
      return config;
    }
  } else {
    const proceed = await confirm({
      message: 'Log in with WeChat using a QR scan?',
      default: true,
    });
    if (!proceed) {
      console.log('ℹ️  Weixin onboarding skipped.');
      console.log('   Configure later with: xopc onboard --channels\n');
      return config;
    }
  }

  const configPath = resolveCliConfigPath();
  const result = await runWeixinQrLoginCli({
    configPath,
    writeConfig: true,
    existingConfig: config,
  });

  if (!result.ok || !result.accountId) {
    console.log(`\n⚠️  ${result.message || 'Weixin login did not complete.'}`);
    console.log('   You can retry from channel setup with: xopc onboard --channels\n');
    return config;
  }

  const merged = mergeWeixinConfigAfterLogin(config, result.accountId);
  console.log('\n✅ Weixin onboarding complete\n');
  return merged;
}

export const weixinOnboardAdapter: ChannelOnboardAdapter = {
  isConfigured: isWeixinOnboardConfigured,
  configure: configureWeixin,
};

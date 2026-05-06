/**
 * DingTalk interactive onboarding — {@link ChannelOnboardAdapter}.
 */

import { confirm } from '@inquirer/prompts';

import type { Config } from '@xopcai/xopc/config/schema.js';
import type { ChannelOnboardAdapter } from '@xopcai/xopc/channels/plugins/types.adapters.js';

import { mergeDingtalkCredentialsIntoConfig } from '../merge-config.js';
import { promptDingtalkCredentials } from '../interactive-credentials.js';

function isDingtalkConfigured(config: Config): boolean {
  const d = config.channels?.dingtalk as Record<string, unknown> | undefined;
  if (!d) return false;
  const id = typeof d.clientId === 'string' ? d.clientId.trim() : '';
  const sec = typeof d.clientSecret === 'string' ? d.clientSecret.trim() : '';
  return Boolean(id && sec && d.enabled === true);
}

async function configureDingtalk(config: Config): Promise<Config> {
  console.log(`\n${'='.repeat(50)}`);
  console.log('DingTalk setup');
  console.log(`${'='.repeat(50)}\n`);

  const existing = config.channels?.dingtalk as Record<string, unknown> | undefined;
  if (existing?.enabled === true && isDingtalkConfigured(config)) {
    const keep = await confirm({
      message: 'DingTalk is already configured. Reconfigure?',
      default: false,
    });
    if (!keep) return config;
  }

  try {
    const { clientId, clientSecret } = await promptDingtalkCredentials({ timeoutMs: 480_000 });
    const next = mergeDingtalkCredentialsIntoConfig(config, { clientId, clientSecret });
    console.log('\nDingTalk configuration complete.\n');
    return next;
  } catch (e) {
    if (e instanceof Error && e.message === 'DingTalk registration cancelled.') {
      return config;
    }
    throw e;
  }
}

export const dingtalkOnboardAdapter: ChannelOnboardAdapter = {
  isConfigured: isDingtalkConfigured,
  configure: configureDingtalk,
};

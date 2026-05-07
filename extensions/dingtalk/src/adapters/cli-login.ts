/**
 * DingTalk CLI login — {@link ChannelCliLoginAdapter} (QR registration + manual credentials).
 */

import fs from 'node:fs';

import type { Config } from '@xopcai/xopc/config/schema.js';
import type { ChannelCliLoginAdapter } from '@xopcai/xopc/channels/plugins/types.adapters.js';

import { mergeDingtalkCredentialsIntoConfig } from '../merge-config.js';
import { promptDingtalkCredentials } from '../interactive-credentials.js';

function loadConfigFromPath(configPath: string): Config {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw) as Config;
  } catch {
    return {} as Config;
  }
}

function writeConfigToPath(configPath: string, config: Config): void {
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export const dingtalkCliLoginAdapter: ChannelCliLoginAdapter = {
  async runLogin(params) {
    const { configPath, verbose, timeoutMs = 480_000, writeConfig = true } = params;

    if (verbose) {
      console.log(`[dingtalk-login] configPath=${configPath}, timeoutMs=${timeoutMs}`);
    }

    const config = loadConfigFromPath(configPath);

    console.log(`\n${'='.repeat(50)}`);
    console.log('DingTalk setup');
    console.log(`${'='.repeat(50)}\n`);

    const { clientId, clientSecret } = await promptDingtalkCredentials({ timeoutMs });
    const next = mergeDingtalkCredentialsIntoConfig(config, { clientId, clientSecret });

    if (writeConfig) {
      writeConfigToPath(configPath, next);
    }

    return { ok: true, message: 'DingTalk credentials saved.', accountId: 'default' };
  },
};

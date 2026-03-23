/**
 * Slack Channel Configurator (Placeholder)
 * 
 * TODO: Full implementation in future iteration
 */

import type { Config } from '../../../../config/schema.js';
import type { ChannelConfigurator } from './types.js';

export const slackConfigurator: ChannelConfigurator = {
  id: 'slack',
  name: 'Slack',
  description: 'Slack messaging via Bot API (coming soon)',
  
  isConfigured(_config: Config): boolean {
    return false; // Not yet implemented
  },
  
  async configure(config: Config): Promise<Config> {
    console.log('\n⚠️  Slack setup is not implemented yet.\n');
    console.log('   Only Telegram is supported for now.\n');
    return config;
  },
};

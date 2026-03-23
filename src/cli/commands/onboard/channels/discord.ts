/**
 * Discord Channel Configurator (Placeholder)
 * 
 * TODO: Full implementation in future iteration
 */

import type { Config } from '../../../../config/schema.js';
import type { ChannelConfigurator } from './types.js';

export const discordConfigurator: ChannelConfigurator = {
  id: 'discord',
  name: 'Discord',
  description: 'Discord messaging via Bot API (coming soon)',
  
  isConfigured(_config: Config): boolean {
    return false; // Not yet implemented
  },
  
  async configure(config: Config): Promise<Config> {
    console.log('\n⚠️  Discord setup is not implemented yet.\n');
    console.log('   Only Telegram is supported for now.\n');
    return config;
  },
};

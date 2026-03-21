/**
 * Discord Channel Configurator (Placeholder)
 * 
 * TODO: Full implementation in future iteration
 */

import type { Config } from '../../../config/schema.js';
import type { ChannelConfigurator } from './types.js';

export const discordConfigurator: ChannelConfigurator = {
  id: 'discord',
  name: 'Discord',
  description: 'Discord messaging via Bot API (coming soon)',
  
  isConfigured(_config: Config): boolean {
    return false; // Not yet implemented
  },
  
  async configure(config: Config): Promise<Config> {
    console.log('\n⚠️  Discord 配置尚未实现\n');
    console.log('   目前仅支持 Telegram 频道\n');
    return config;
  },
};

/**
 * Bundled Feishu/Lark channel extension entry.
 */

import { defineChannelPluginEntry } from '@xopcai/xopc/extensions/sdk/channel-entry.js';

import { feishuPlugin } from './plugin.js';

export { feishuPlugin } from './plugin.js';
export { defineChannelPluginEntry } from '@xopcai/xopc/extensions/sdk/channel-entry.js';

export default defineChannelPluginEntry({
  id: 'feishu',
  name: 'Feishu',
  description: 'Feishu/Lark messaging and workspace tools',
  plugin: feishuPlugin,
});

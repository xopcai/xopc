/**
 * Built-in channel plugins: sources under extensions/*, compiled to dist/extensions/*.
 * Regenerate: pnpm run generate:bundled-channels
 */

import type { ChannelPlugin } from '../channels/plugin-types.js';
import { telegramPlugin } from '../../extensions/telegram/src/index.js';
import { weixinPlugin } from '../../extensions/weixin/src/index.js';
import { feishuPlugin } from '../../extensions/feishu/src/index.js';

export { telegramPlugin, weixinPlugin, feishuPlugin };
export const bundledChannelPlugins: ChannelPlugin[] = [telegramPlugin, weixinPlugin, feishuPlugin];

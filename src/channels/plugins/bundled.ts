/**
 * Built-in channel plugins shipped with the core binary.
 */

import type { ChannelPlugin } from '../plugin-types.js';
import { telegramPlugin } from '@xopcai/xopcbot-extension-telegram';
import { weixinPlugin } from '@xopcai/xopcbot-extension-weixin';

export const bundledChannelPlugins: ChannelPlugin[] = [telegramPlugin, weixinPlugin];

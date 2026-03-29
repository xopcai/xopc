/**
 * Built-in channel plugins shipped with the core binary.
 */

import type { ChannelPlugin } from '../plugin-types.js';
import { telegramPlugin, weixinPlugin } from '../../generated/bundled-channel-plugins.js';

export const bundledChannelPlugins: ChannelPlugin[] = [telegramPlugin, weixinPlugin];

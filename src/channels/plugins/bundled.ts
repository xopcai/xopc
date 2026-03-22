/**
 * Built-in channel plugins shipped with the core binary.
 */

import type { ChannelPlugin } from '../plugin-types.js';
import { telegramPlugin } from '../../extensions/telegram/index.js';

export const bundledChannelPlugins: ChannelPlugin[] = [telegramPlugin];

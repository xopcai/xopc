import { join } from 'node:path';

import { resolveStateDir as resolveXopcbotStateDir } from '@xopcai/xopcbot/config/paths.js';

/** Root for Weixin channel state: accounts, sync buffers, context tokens. */
export function resolveWeixinRootDir(): string {
  return join(resolveXopcbotStateDir(), 'weixin');
}

/** @deprecated Use resolveWeixinRootDir; kept for internal modules that expect this name. */
export function resolveStateDir(): string {
  return resolveWeixinRootDir();
}

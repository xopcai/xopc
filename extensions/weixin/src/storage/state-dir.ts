import { join } from 'node:path';

import { resolveStateDir as resolveXopcStateDir } from '@xopcai/xopc/config/paths.js';

/** Root for Weixin channel state: accounts, sync buffers, context tokens. */
export function resolveWeixinRootDir(): string {
  return join(resolveXopcStateDir(), 'weixin');
}

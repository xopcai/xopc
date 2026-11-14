import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

declare const XOPC_BUNDLED_CLI_GATEWAY: boolean;

/** Use bundled copies only for releases' own manifests and entry points. */
export function loadBundledStartupModule(path: string, id: string): Promise<{ default: unknown }> | undefined {
  if (typeof XOPC_BUNDLED_CLI_GATEWAY === 'undefined' || !XOPC_BUNDLED_CLI_GATEWAY) return;
  const root = fileURLToPath(new URL('../../extensions/', import.meta.url));
  const directory = id === 'feishu-tools' ? 'feishu' : id;
  if (normalize(path) !== join(root, directory, 'src', 'index.js')) return;
  switch (id) {
    case 'telegram': return import('../../extensions/telegram/src/index.js');
    case 'feishu-tools': return import('../../extensions/feishu/src/index.js');
    case 'dingtalk': return import('../../extensions/dingtalk/src/index.js');
    case 'wecom': return import('../../extensions/wecom/src/index.js');
    case 'slack': return import('../../extensions/slack/src/index.js');
    case 'discord': return import('../../extensions/discord/src/index.js');
    case 'weixin': return import('../../extensions/weixin/src/index.js');
  }
}

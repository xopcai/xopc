import { createRequire } from 'node:module';
import { join } from 'node:path';

import { resolveStateDir } from '@xopcai/xopc/config/paths.js';

import { FEISHU_SDK_PACKAGES } from './sdk-catalog.js';

type LarkSdk = typeof import('@larksuiteoapi/node-sdk');

const SDK_PACKAGE = '@larksuiteoapi/node-sdk';
export function managedFeishuSdkPath(): string {
  const version = FEISHU_SDK_PACKAGES.find(([name]) => name === SDK_PACKAGE)![1];
  return join(resolveStateDir(), 'tools', 'feishu-sdk', version);
}

let cachedSdk: LarkSdk | undefined;

export function loadFeishuLarkSdk(): LarkSdk {
  if (cachedSdk) return cachedSdk;
  const managedPackage = join(managedFeishuSdkPath(), 'node_modules', SDK_PACKAGE);
  try {
    cachedSdk = createRequire(import.meta.url)(managedPackage) as LarkSdk;
    return cachedSdk;
  } catch {
    // npm installs may already supply the SDK as an optional peer.
  }
  try {
    cachedSdk = createRequire(import.meta.url)(SDK_PACKAGE) as LarkSdk;
    return cachedSdk;
  } catch (cause) {
    throw new Error('The Feishu SDK is unavailable. Open Feishu setup to install the channel component.', { cause });
  }
}

export async function ensureFeishuLarkSdk(): Promise<LarkSdk> {
  try {
    return loadFeishuLarkSdk();
  } catch {
    const { installFeishuSdk } = await import('./install-sdk.js');
    await installFeishuSdk();
    return loadFeishuLarkSdk();
  }
}

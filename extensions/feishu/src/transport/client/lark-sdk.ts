import { createRequire } from 'node:module';

type LarkSdk = typeof import('@larksuiteoapi/node-sdk');

let cachedSdk: LarkSdk | undefined;

export function loadFeishuLarkSdk(): LarkSdk {
  if (cachedSdk) return cachedSdk;
  try {
    const require = createRequire(import.meta.url);
    cachedSdk = require('@larksuiteoapi/node-sdk') as LarkSdk;
    return cachedSdk;
  } catch (cause) {
    throw new Error(
      'The Feishu channel requires @larksuiteoapi/node-sdk. Install it alongside @xopcai/xopc; '
      + 'use npm install -g when xopc is installed globally.',
      { cause },
    );
  }
}

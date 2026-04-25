import lark from '@larksuiteoapi/node-sdk';

import type { ResolvedFeishuAccount } from '../../state/accounts.js';

export function createFeishuClient(account: ResolvedFeishuAccount): {
  wsClient: any;
  dispatcher: any;
  api: any;
} {
  const l = lark as any;

  const apiBaseUrl = resolveFeishuBaseUrl(account.domain);

  const api = new l.Client({
    appId: account.appId,
    appSecret: account.appSecret,
    ...(apiBaseUrl ? { baseURL: apiBaseUrl } : {}),
  });

  const dispatcher = new l.EventDispatcher({ verifyChallenge: false } as any);
  const wsClient = new l.WSClient({
    appId: account.appId,
    appSecret: account.appSecret,
    eventDispatcher: dispatcher,
    ...(apiBaseUrl ? { baseURL: apiBaseUrl } : {}),
  });

  return { wsClient, dispatcher, api };
}

function resolveFeishuBaseUrl(domain: string): string | undefined {
  if (domain === 'feishu') {
    return 'https://open.feishu.cn';
  }
  if (domain === 'lark') {
    return 'https://open.larksuite.com';
  }
  if (domain && domain.startsWith('https://')) {
    return domain;
  }
  return undefined;
}


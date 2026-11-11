import type { ResolvedFeishuAccount } from '../../state/accounts.js';
import { loadFeishuLarkSdk } from './lark-sdk.js';
import { createFeishuLarkSdkPinoLogger } from './lark-sdk-logger.js';

export function createFeishuClient(account: ResolvedFeishuAccount, lifecycle?: {
  onReady?: () => void;
  onError?: (error: unknown) => void;
  onReconnecting?: () => void;
  onReconnected?: () => void;
}): {
  wsClient: any;
  dispatcher: any;
  api: any;
} {
  const l = loadFeishuLarkSdk() as any;
  const sdkLogger = createFeishuLarkSdkPinoLogger(account.accountId);

  const apiBaseUrl = resolveFeishuBaseUrl(account.domain);

  const api = new l.Client({
    appId: account.appId,
    appSecret: account.appSecret,
    logger: sdkLogger,
    loggerLevel: l.LoggerLevel.info,
    ...(apiBaseUrl ? { domain: apiBaseUrl } : {}),
  });

  const dispatcher = new l.EventDispatcher({ verifyChallenge: false, logger: sdkLogger, loggerLevel: l.LoggerLevel.info } as any);
  const wsClient = new l.WSClient({
    appId: account.appId,
    appSecret: account.appSecret,
    ...lifecycle,
    handshakeTimeoutMs: 15_000,
    logger: sdkLogger,
    loggerLevel: l.LoggerLevel.info,
    ...(apiBaseUrl ? { domain: apiBaseUrl } : {}),
  });

  return { wsClient, dispatcher, api };
}

export function resolveFeishuBaseUrl(domain: string): string | undefined {
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

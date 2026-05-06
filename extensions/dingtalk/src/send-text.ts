import type { DingtalkConfig } from './config-schema.js';

import { getDingtalkAccessToken } from './token.js';

/**
 * Send a plain text reply to the current DingTalk conversation via session webhook.
 */
export async function sendDingtalkTextMessage(params: {
  config: Pick<DingtalkConfig, 'clientId' | 'clientSecret'>;
  sessionWebhook: string;
  text: string;
}): Promise<void> {
  const token = await getDingtalkAccessToken(params.config);
  const body = {
    msgtype: 'text',
    text: { content: params.text },
  };
  const res = await fetch(params.sessionWebhook, {
    method: 'POST',
    headers: {
      'x-acs-dingtalk-access-token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`DingTalk send failed: HTTP ${res.status} ${t.slice(0, 200)}`);
  }
}

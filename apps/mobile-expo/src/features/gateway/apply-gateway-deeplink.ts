import type { ImperativeRouter } from 'expo-router';

import { navigateHomeAfterGatewayConnect } from './navigate-after-gateway-connect';
import { pairGatewayLink } from './pair-gateway';
import { parseGatewayQrPayload } from './parse-gateway-qr';

const inflight = new Map<string, Promise<boolean>>();

export async function tryConsumeGatewayDeeplink(
  rawUrl: string,
  router: ImperativeRouter,
): Promise<boolean> {
  if (!parseGatewayQrPayload(rawUrl)) return false;
  const existing = inflight.get(rawUrl);
  if (existing) return existing;
  const task = (async () => {
    try {
      await pairGatewayLink(rawUrl);
      return (await navigateHomeAfterGatewayConnect(router.replace)).ok;
    } catch (error) {
      if (__DEV__) console.warn('[gateway-pairing] pairing failed', error);
      return false;
    }
  })();
  inflight.set(rawUrl, task);
  try {
    return await task;
  } finally {
    if (inflight.get(rawUrl) === task) inflight.delete(rawUrl);
  }
}

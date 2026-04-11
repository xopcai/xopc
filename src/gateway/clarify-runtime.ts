import type { ClarifyBridge } from './clarify-bridge.js';

let bridgeRef: ClarifyBridge | null = null;

export function registerClarifyBridge(bridge: ClarifyBridge | null): void {
  bridgeRef = bridge;
}

export function submitClarifyResponseFromChannel(requestId: string, answer: string): boolean {
  return bridgeRef?.handleResponse(requestId, answer) ?? false;
}

export function submitClarifyChoiceFromChannel(requestId: string, choiceIndex: number): boolean {
  return bridgeRef?.handleChoiceCallback(requestId, choiceIndex) ?? false;
}

export function tryConsumeTelegramClarifyFreeText(sessionKey: string, text: string): boolean {
  return bridgeRef?.tryConsumeFreeTextReply(sessionKey, text) ?? false;
}

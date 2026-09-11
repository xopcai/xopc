export function canStartChatBootstrap(input: {
  gatewayReady: boolean;
  gatewayOnline: boolean;
  urlSessionKey: string;
  resumeLookupComplete: boolean;
  alreadyAttempted: boolean;
}): boolean {
  return input.gatewayReady
    && input.gatewayOnline
    && !input.urlSessionKey
    && input.resumeLookupComplete
    && !input.alreadyAttempted;
}

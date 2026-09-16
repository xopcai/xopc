export function canStartChatBootstrap(input: {
  gatewayReady: boolean;
  gatewayOnline: boolean;
  urlConversationId: string;
  resumeLookupComplete: boolean;
  alreadyAttempted: boolean;
}): boolean {
  return input.gatewayReady
    && input.gatewayOnline
    && !input.urlConversationId
    && input.resumeLookupComplete
    && !input.alreadyAttempted;
}

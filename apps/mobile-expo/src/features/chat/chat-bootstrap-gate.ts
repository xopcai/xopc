export function canStartChatBootstrap(input: {
  gatewayReady: boolean;
  gatewayOnline: boolean;
  urlConversationId: string;
  alreadyAttempted: boolean;
}): boolean {
  return input.gatewayReady
    && !input.urlConversationId
    && !input.alreadyAttempted;
}

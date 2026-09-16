export function canStartChatBootstrap(input: {
  gatewayReady: boolean;
  gatewayOnline: boolean;
  urlConversationId: string;
  alreadyAttempted: boolean;
}): boolean {
  return input.gatewayReady
    && input.gatewayOnline
    && !input.urlConversationId
    && !input.alreadyAttempted;
}

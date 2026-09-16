export function desktopPetWindowTarget(
  activity?: { conversationId: string },
): string | undefined {
  return activity ? `/chat/${activity.conversationId}` : undefined;
}

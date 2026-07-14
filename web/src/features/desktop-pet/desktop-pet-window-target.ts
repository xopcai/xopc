export function desktopPetWindowTarget(
  activity?: { sessionKey: string },
): string | undefined {
  return activity ? `/chat/${activity.sessionKey}` : undefined;
}

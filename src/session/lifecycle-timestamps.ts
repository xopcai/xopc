export type SessionLifecycleEntry = {
  sessionStartedAt?: number;
  lastInteractionAt?: number;
  updatedAt?: number;
};

function resolveTimestamp(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function resolveSessionLifecycleTimestamps(params: {
  entry: SessionLifecycleEntry | undefined;
}): { sessionStartedAt?: number; lastInteractionAt?: number } {
  const entry = params.entry;
  if (!entry) {
    return {};
  }
  return {
    sessionStartedAt: resolveTimestamp(entry.sessionStartedAt),
    lastInteractionAt: resolveTimestamp(entry.lastInteractionAt),
  };
}

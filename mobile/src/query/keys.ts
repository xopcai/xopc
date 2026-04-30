export const queryKeys = {
  sessions: ['sessions'] as const,
  session: (key: string) => ['session', key] as const,
  agents: ['agents'] as const,
};

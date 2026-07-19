export const USER_TRUST_LEVELS = ['observe', 'suggest', 'confirm', 'auto'] as const;

export type UserTrustLevel = typeof USER_TRUST_LEVELS[number];

export const DEFAULT_USER_TRUST_LEVEL: UserTrustLevel = 'confirm';

export type UserTrustPolicy = {
  principalId: string;
  defaultActionLevel: UserTrustLevel;
  updatedAt?: string;
};

export function isUserTrustLevel(value: unknown): value is UserTrustLevel {
  return typeof value === 'string' && USER_TRUST_LEVELS.includes(value as UserTrustLevel);
}

export function resolveAutomationSafetyForTrust(
  level: UserTrustLevel,
  requested: 'suggest_only' | 'ask_before_apply' | 'auto_apply' | undefined,
): 'suggest_only' | 'ask_before_apply' | 'auto_apply' {
  if (level === 'observe' || level === 'suggest') return 'suggest_only';
  if (level === 'confirm') {
    return requested === 'suggest_only' ? 'suggest_only' : 'ask_before_apply';
  }
  return requested ?? 'suggest_only';
}

export function buildActionTrustPrompt(level: UserTrustLevel): string {
  const shared = [
    '## Action Trust Boundary',
    `Current default: ${level}.`,
    '- This controls agent-initiated or proactive actions. A direct user request in the current turn is explicit approval to carry out that request within existing safety and permission boundaries.',
    '- Never expand connector permissions, workflow scope, credentials, or access because of this setting.',
    '- Irreversible, destructive, financial, permission-expanding, or public external actions still require explicit confirmation.',
  ];
  const instruction = level === 'observe'
    ? '- For proactive work, observe and build context only; do not prepare or initiate actions.'
    : level === 'suggest'
      ? '- For proactive work, explain the recommendation and rationale, then let the user decide whether to proceed.'
      : level === 'confirm'
        ? '- For proactive work, prepare the action, but request approval before executing any mutating or external step.'
        : '- For proactive work, you may execute within already-authorized, recoverable boundaries without asking each time.';
  return [...shared, instruction].join('\n');
}

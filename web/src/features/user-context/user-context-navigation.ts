export type UserContextViewId = 'overview' | 'memory' | 'collaboration' | 'sources' | 'privacy';

const USER_CONTEXT_VIEW_IDS = new Set<UserContextViewId>([
  'overview',
  'memory',
  'collaboration',
  'sources',
  'privacy',
]);

export function userContextViewFromTab(value: string | null): UserContextViewId {
  return value && USER_CONTEXT_VIEW_IDS.has(value as UserContextViewId)
    ? value as UserContextViewId
    : 'overview';
}

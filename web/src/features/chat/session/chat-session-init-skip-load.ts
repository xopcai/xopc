/** Skip redundant REST load immediately after POST createSession. */
let skipInitialLoadForKey: string | null = null;

export function markSkipInitialSessionLoad(sessionKey: string): void {
  const key = String(sessionKey ?? '').trim();
  skipInitialLoadForKey = key || null;
}

export function takeSkipInitialSessionLoad(sessionKey: string): boolean {
  const key = String(sessionKey ?? '').trim();
  if (!key || skipInitialLoadForKey !== key) return false;
  skipInitialLoadForKey = null;
  return true;
}

export function resetSkipInitialSessionLoadForTests(): void {
  skipInitialLoadForKey = null;
}

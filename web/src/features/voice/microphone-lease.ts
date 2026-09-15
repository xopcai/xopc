let owner: symbol | null = null;

export function acquireMicrophoneLease(candidate: symbol): boolean {
  if (owner && owner !== candidate) return false;
  owner = candidate;
  return true;
}

export function releaseMicrophoneLease(candidate: symbol): void {
  if (owner === candidate) owner = null;
}

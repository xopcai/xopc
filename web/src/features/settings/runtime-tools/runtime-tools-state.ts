import type { RuntimeStatus } from './runtime-tools-api';

function normalizedVersion(version: string | undefined): string | undefined {
  const normalized = version?.trim();
  return normalized || undefined;
}

export function runtimeNeedsInstall(
  status: RuntimeStatus | undefined,
  draftVersion: string | undefined,
  savedVersion: string | undefined,
): boolean {
  if (status?.state !== 'ready') return true;
  return normalizedVersion(draftVersion) !== normalizedVersion(savedVersion);
}

export const REMOTE_ACCESS_TABS = [
  'guide',
  'tailscale',
  'public',
  'reverse-proxy',
  'ssh',
  'lan',
] as const;

export type RemoteAccessTabId = (typeof REMOTE_ACCESS_TABS)[number];

export function parseRemoteAccessTab(raw: string | null): RemoteAccessTabId {
  if (raw && (REMOTE_ACCESS_TABS as readonly string[]).includes(raw)) {
    return raw as RemoteAccessTabId;
  }
  return 'guide';
}

import { isElectron } from '@/lib/electron-env';

export function reserveOAuthAuthorizationWindow(): Window | null {
  if (isElectron()) return null;
  const popup = window.open('about:blank', 'xopc-oauth');
  if (popup) popup.opener = null;
  return popup;
}

export async function openOAuthAuthorizationUrl(
  url: string,
  popup: Window | null,
): Promise<boolean> {
  if (isElectron()) {
    const result = await window.electronAPI?.shell?.openExternalUrl(url);
    return result?.ok === true;
  }
  if (!popup || popup.closed) return false;
  popup.location.replace(url);
  return true;
}

export function closeOAuthAuthorizationWindow(popup: Window | null): void {
  if (popup && !popup.closed) popup.close();
}

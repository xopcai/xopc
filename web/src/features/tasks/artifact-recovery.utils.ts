import type { ShareItem } from '@/features/shares/shares-api';

export function matchArtifactShare(uri: string, shares: ShareItem[]): ShareItem | undefined {
  let target: URL;
  try { target = new URL(uri); } catch { return undefined; }
  return shares.find(share => [share.shareUrl, share.lanUrl].some(value => {
    if (!value) return false;
    try {
      const candidate = new URL(value);
      return candidate.origin === target.origin && candidate.pathname.replace(/\/$/, '') === target.pathname.replace(/\/$/, '');
    } catch { return false; }
  }));
}

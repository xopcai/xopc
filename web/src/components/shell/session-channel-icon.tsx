import { Hash } from 'lucide-react';

import { cn } from '@/lib/cn';

const BRAND_IMG_BY_CHANNEL: Record<string, string> = {
  // Static assets in `web/public` (served as `/…` in Vite + gateway static root).
  feishu: '/channel-icons/feishu.svg',
  lark: '/channel-icons/lark.svg',
};

/** Small glyph for `SessionMetadata.sourceChannel` in sidebar / lists (some channels use brand marks from `web/public`). */
export function SessionChannelIcon({
  sourceChannel,
  className,
}: {
  sourceChannel: string;
  className?: string;
}) {
  const key = sourceChannel.toLowerCase();
  const brandSrc = BRAND_IMG_BY_CHANNEL[key];
  if (brandSrc) {
    return (
      <img
        src={brandSrc}
        alt=""
        draggable={false}
        className={cn('shrink-0', className)}
        aria-hidden
      />
    );
  }

  return <Hash className={cn('shrink-0', className)} strokeWidth={1.75} aria-hidden />;
}

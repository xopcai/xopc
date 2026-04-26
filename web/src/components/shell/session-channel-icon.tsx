import type { LucideIcon } from 'lucide-react';
import { Hash, MessagesSquare, Send } from 'lucide-react';

import { cn } from '@/lib/cn';

const ICON_BY_CHANNEL: Record<string, LucideIcon> = {
  telegram: Send,
  weixin: MessagesSquare,
};

const BRAND_IMG_BY_CHANNEL: Record<string, string> = {
  // Static assets in `web/public` (served as `/…` in Vite + gateway static root).
  feishu: '/channel-icons/feishu.svg',
  lark: '/channel-icons/lark.svg',
};

function iconForSourceChannel(sourceChannel: string): LucideIcon {
  return ICON_BY_CHANNEL[sourceChannel.toLowerCase()] ?? Hash;
}

/** Small glyph for `SessionMetadata.sourceChannel` in sidebar / lists (not brand logos). */
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

  const Icon = iconForSourceChannel(key);
  return <Icon className={cn('shrink-0', className)} strokeWidth={1.75} aria-hidden />;
}

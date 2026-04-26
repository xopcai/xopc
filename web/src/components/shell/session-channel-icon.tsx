import type { LucideIcon } from 'lucide-react';
import { Hash, MessageCircle, MessagesSquare, Send } from 'lucide-react';

import { cn } from '@/lib/cn';

const ICON_BY_CHANNEL: Record<string, LucideIcon> = {
  telegram: Send,
  weixin: MessagesSquare,
  feishu: MessageCircle,
  lark: MessageCircle,
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
  const Icon = iconForSourceChannel(sourceChannel);
  return <Icon className={cn('shrink-0', className)} strokeWidth={1.75} aria-hidden />;
}

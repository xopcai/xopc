import { MessageSquare, Send, type LucideIcon } from 'lucide-react';

import type { ManageableChannelId } from './channels-routes';

export type BuiltinChannelCatalogEntry = {
  id: ManageableChannelId;
  icon: LucideIcon;
  titleKey: 'telegramTitle' | 'weixinTitle' | 'feishuTitle';
  subtitleKey: 'telegramSubtitle' | 'weixinSubtitle' | 'feishuSubtitle';
};

/** Static built-in channel metadata (i18n keys). Dynamic catalog merges API `/api/channels/meta`. */
export const BUILTIN_CHANNEL_CATALOG: readonly BuiltinChannelCatalogEntry[] = [
  {
    id: 'telegram',
    icon: Send,
    titleKey: 'telegramTitle',
    subtitleKey: 'telegramSubtitle',
  },
  {
    id: 'weixin',
    icon: MessageSquare,
    titleKey: 'weixinTitle',
    subtitleKey: 'weixinSubtitle',
  },
  {
    id: 'feishu',
    icon: MessageSquare,
    titleKey: 'feishuTitle',
    subtitleKey: 'feishuSubtitle',
  },
] as const;

/** @deprecated Use `useChannelCatalog` / `BUILTIN_CHANNEL_CATALOG` */
export const CHANNEL_CATALOG = BUILTIN_CHANNEL_CATALOG;

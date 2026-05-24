import type { ManageableChannelId } from './channels-routes';

export type BuiltinChannelCatalogEntry = {
  id: ManageableChannelId;
  titleKey: 'telegramTitle' | 'weixinTitle' | 'feishuTitle';
  subtitleKey: 'telegramSubtitle' | 'weixinSubtitle' | 'feishuSubtitle';
};

/** Static built-in channel metadata (i18n keys). Dynamic catalog merges API `/api/channels/meta`. */
export const BUILTIN_CHANNEL_CATALOG: readonly BuiltinChannelCatalogEntry[] = [
  {
    id: 'telegram',
    titleKey: 'telegramTitle',
    subtitleKey: 'telegramSubtitle',
  },
  {
    id: 'weixin',
    titleKey: 'weixinTitle',
    subtitleKey: 'weixinSubtitle',
  },
  {
    id: 'feishu',
    titleKey: 'feishuTitle',
    subtitleKey: 'feishuSubtitle',
  },
] as const;

/** @deprecated Use `useChannelCatalog` / `BUILTIN_CHANNEL_CATALOG` */
export const CHANNEL_CATALOG = BUILTIN_CHANNEL_CATALOG;

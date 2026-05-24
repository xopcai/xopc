import { MessageSquare, Send, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import useSWR from 'swr';

import type { ChannelsSettingsMessages } from '@/i18n/messages';

import { BUILTIN_CHANNEL_CATALOG, type BuiltinChannelCatalogEntry } from './channel-catalog';
import { channelsMetaSwrKey, fetchChannelsMeta, type ChannelHubMetaRow } from './channels-meta-api';

export type ChannelCatalogEntry = {
  id: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
  manageable: boolean;
  order: number;
};

function iconForChannelId(id: string): LucideIcon {
  if (id === 'telegram') return Send;
  return MessageSquare;
}

function resolveBuiltinCopy(
  entry: BuiltinChannelCatalogEntry,
  ch: ChannelsSettingsMessages,
): { title: string; subtitle: string } {
  return {
    title: ch[entry.titleKey],
    subtitle: ch[entry.subtitleKey],
  };
}

export function mergeChannelCatalog(
  metaRows: ChannelHubMetaRow[] | undefined,
  ch: ChannelsSettingsMessages,
): ChannelCatalogEntry[] {
  const byId = new Map<string, ChannelCatalogEntry>();

  for (const row of metaRows ?? []) {
    const builtin = BUILTIN_CHANNEL_CATALOG.find((b) => b.id === row.id);
    const copy = builtin
      ? resolveBuiltinCopy(builtin, ch)
      : { title: row.label, subtitle: row.description || ch.hubExtensionSubtitle };
    byId.set(row.id, {
      id: row.id,
      icon: iconForChannelId(row.id),
      title: copy.title,
      subtitle: copy.subtitle,
      manageable: row.manageable,
      order: row.order,
    });
  }

  if (byId.size === 0) {
    return BUILTIN_CHANNEL_CATALOG.map((entry, index) => {
      const copy = resolveBuiltinCopy(entry, ch);
      return {
        id: entry.id,
        icon: entry.icon,
        title: copy.title,
        subtitle: copy.subtitle,
        manageable: true,
        order: index,
      };
    });
  }

  for (const entry of BUILTIN_CHANNEL_CATALOG) {
    if (byId.has(entry.id)) continue;
    const copy = resolveBuiltinCopy(entry, ch);
    byId.set(entry.id, {
      id: entry.id,
      icon: entry.icon,
      title: copy.title,
      subtitle: copy.subtitle,
      manageable: true,
      order: BUILTIN_CHANNEL_CATALOG.findIndex((b) => b.id === entry.id),
    });
  }

  return Array.from(byId.values()).sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.id.localeCompare(b.id);
  });
}

export function useChannelCatalog(hasToken: boolean, ch: ChannelsSettingsMessages) {
  const { data, error, isLoading, mutate } = useSWR(
    hasToken ? channelsMetaSwrKey() : null,
    fetchChannelsMeta,
    { revalidateOnFocus: false },
  );

  const entries = useMemo(() => mergeChannelCatalog(data, ch), [data, ch]);

  return { entries, isLoading, error, mutate };
}

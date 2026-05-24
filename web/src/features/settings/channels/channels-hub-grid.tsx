import { ChannelHubCard } from './channel-hub-card';
import type { ChannelHubCardVm } from './channel-hub-view-model';
import type { ChannelCatalogEntry } from './use-channel-catalog';
import type { ChannelsSettingsMessages } from '@/i18n/messages';

export type OpenChannelOptions = {
  scrollToPairing?: boolean;
};

export function ChannelsHubGrid(props: {
  catalog: ChannelCatalogEntry[];
  cards: ChannelHubCardVm[];
  ch: ChannelsSettingsMessages;
  saving: boolean;
  onOpenChannel: (id: string, opts?: OpenChannelOptions) => void;
  onToggleChannel: (id: string, enabled: boolean) => void | Promise<void>;
}) {
  const { catalog, cards, ch, saving, onOpenChannel, onToggleChannel } = props;

  const cardById = new Map(cards.map((c) => [c.id, c]));

  return (
    <ul
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]"
      role="list"
    >
      {catalog.map((entry) => {
        const vm = cardById.get(entry.id);
        if (!vm) return null;
        const openPairing = () => onOpenChannel(entry.id, { scrollToPairing: true });
        return (
          <li key={entry.id} className="h-full min-h-0">
            <ChannelHubCard
              channelId={entry.id}
              title={entry.title}
              subtitle={entry.subtitle}
              vm={vm}
              toggleDisabled={saving || !vm.manageable}
              onOpen={() => onOpenChannel(entry.id)}
              onReviewPairing={openPairing}
              onToggle={(next) => onToggleChannel(entry.id, next)}
              ch={ch}
            />
          </li>
        );
      })}
    </ul>
  );
}

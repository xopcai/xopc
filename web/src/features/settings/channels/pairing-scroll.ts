import type { PairingChannelId } from '@/features/settings/channels-config-api';

export function channelPairingSectionDomId(channel: PairingChannelId): string {
  return `channel-pairing-${channel}`;
}

export function scrollToChannelPairingSection(channel: PairingChannelId): void {
  requestAnimationFrame(() => {
    document.getElementById(channelPairingSectionDomId(channel))?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  });
}

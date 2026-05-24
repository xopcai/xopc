import { describe, expect, it } from 'vitest';

import { defaultChannelsState } from '@/features/settings/channels-config-api';
import { messages } from '@/i18n/messages';

import {
  buildExtensionChannelHubCardVm,
  buildManageableChannelHubCardVm,
  resolveChannelConnected,
} from '@/features/settings/channels/channel-hub-view-model';

const ch = messages('en').channelsSettings;

describe('channel-hub-view-model', () => {
  it('resolveChannelConnected reads runtime status', () => {
    expect(
      resolveChannelConnected(
        [
          { name: 'telegram', enabled: true, connected: true },
          { name: 'weixin', enabled: false, connected: false },
        ],
        'telegram',
      ),
    ).toBe(true);
    expect(
      resolveChannelConnected([{ name: 'telegram', enabled: true, connected: false }], 'telegram'),
    ).toBe(false);
  });

  it('buildChannelHubCardVm marks unconfigured telegram', () => {
    const form = defaultChannelsState();
    form.telegram.accounts = { default: { ...form.telegram.accounts.default, botToken: '' } };

    const vm = buildManageableChannelHubCardVm({
      id: 'telegram',
      form,
      connected: false,
      pairingSummary: {
        telegram: { pending: 0, stale: 0, atCapacity: false },
        feishu: { pending: 0, stale: 0, atCapacity: false },
        weixin: { pending: 0, stale: 0, atCapacity: false },
      },
      ch,
    });

    expect(vm.manageable).toBe(true);
    expect(vm.status).toBe('not_configured');
    expect(vm.primaryAction).toBe('setup');
    expect(vm.summaryLines).toEqual([]);
  });

  it('buildChannelHubCardVm marks running when enabled and connected', () => {
    const form = defaultChannelsState();
    form.telegram.enabled = true;
    form.telegram.accounts.default.botToken = '123:abc';

    const vm = buildManageableChannelHubCardVm({
      id: 'telegram',
      form,
      connected: true,
      pairingSummary: {
        telegram: { pending: 0, stale: 0, atCapacity: false },
        feishu: { pending: 0, stale: 0, atCapacity: false },
        weixin: { pending: 0, stale: 0, atCapacity: false },
      },
      ch,
    });

    expect(vm.status).toBe('running');
    expect(vm.primaryAction).toBe('manage');
    expect(vm.summaryLines[0]).toContain('DM:');
  });

  it('buildChannelHubCardVm prefers pairing action when pending approvals exist', () => {
    const form = defaultChannelsState();
    form.telegram.enabled = true;
    form.telegram.accounts.default.botToken = '123:abc';

    const vm = buildManageableChannelHubCardVm({
      id: 'telegram',
      form,
      connected: true,
      pairingSummary: {
        telegram: { pending: 2, stale: 0, atCapacity: false },
        feishu: { pending: 0, stale: 0, atCapacity: false },
        weixin: { pending: 0, stale: 0, atCapacity: false },
      },
      ch,
    });

    expect(vm.pendingPairing).toBe(2);
    expect(vm.primaryAction).toBe('pairing');
  });

  it('buildChannelHubCardVm marks offline when enabled but not connected', () => {
    const form = defaultChannelsState();
    form.telegram.enabled = true;
    form.telegram.accounts.default.botToken = '123:abc';

    const vm = buildManageableChannelHubCardVm({
      id: 'telegram',
      form,
      connected: false,
      pairingSummary: {
        telegram: { pending: 0, stale: 0, atCapacity: false },
        feishu: { pending: 0, stale: 0, atCapacity: false },
        weixin: { pending: 0, stale: 0, atCapacity: false },
      },
      ch,
    });

    expect(vm.status).toBe('offline');
    expect(vm.primaryAction).toBe('fix');
  });

  it('buildExtensionChannelHubCardVm marks extension channels as read-only hub cards', () => {
    const vm = buildExtensionChannelHubCardVm({
      id: 'matrix',
      config: { channels: { matrix: { enabled: true, homeserver: 'https://example.org' } } },
      statuses: [{ name: 'matrix', enabled: true, connected: false }],
      ch,
    });

    expect(vm.manageable).toBe(false);
    expect(vm.configured).toBe(true);
    expect(vm.status).toBe('offline');
    expect(vm.primaryAction).toBe('manage');
  });
});

// @vitest-environment jsdom

import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messages } from '@/i18n/messages';
import { apiFetch, fetchJson } from '@/lib/fetch';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import {
  getManagedChannelSchemaPaths,
  readChannelAccessView,
  updateChannelAccessConfig,
} from '../channel-access-config';
import { CHANNELS_HUB_PATH } from '../channels-routes';
import { ChannelsSettingsPanel } from '../channels-settings-panel';
import type { ChannelCatalogEntry } from '../use-channel-catalog';

vi.mock('@/lib/fetch', () => ({ apiFetch: vi.fn(), fetchJson: vi.fn() }));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,fixture' } }));

describe('channel-access-config', () => {
  it('writes access updates into the active account for account-scoped channels (telegram, feishu, weixin)', () => {
    const telegramEntry: ChannelCatalogEntry = {
      id: 'telegram',
      extensionId: 'telegram',
      source: 'bundled',
      label: 'Telegram',
      order: 10,
      configPath: 'channels.telegram',
      configSchema: {
        type: 'object',
        properties: {
          accounts: {
            type: 'object',
            properties: {
              default: {
                type: 'object',
                properties: {
                  dmPolicy: { type: 'string' },
                  groupPolicy: { type: 'string' },
                },
              },
            },
          },
        },
      },
    };
    const initial = {
      enabled: true,
      accounts: { default: { botToken: '123:abc', dmPolicy: 'pairing', groupPolicy: 'open' } },
    };
    const view = readChannelAccessView(telegramEntry, initial);
    expect(view).toMatchObject({
      accountId: 'default',
      supportsDm: true,
      supportsGroup: true,
      dmPolicy: 'pairing',
      groupPolicy: 'open',
    });

    const updated = updateChannelAccessConfig('telegram', initial, { dmPolicy: 'open' });
    expect(updated).toEqual({
      enabled: true,
      accounts: {
        default: {
          botToken: '123:abc',
          dmPolicy: 'open',
          allowFrom: ['*'],
          groupPolicy: 'open',
        },
      },
    });

    const weixinConfig = {
      enabled: true,
      accounts: { 'wx-bot-1': { enabled: true, dmPolicy: 'allowlist', allowFrom: ['u1@im.wechat'] } },
    };
    const weixinUpdated = updateChannelAccessConfig('weixin', weixinConfig, { dmPolicy: 'open' });
    expect(weixinUpdated).toEqual({
      enabled: true,
      accounts: { 'wx-bot-1': { enabled: true, dmPolicy: 'open', allowFrom: ['u1@im.wechat'] } },
    });
  });

  it('omits credentials and access fields from raw SchemaForm when setup actions exist', () => {
    const paths = getManagedChannelSchemaPaths({
      id: 'dingtalk',
      extensionId: 'dingtalk',
      source: 'bundled',
      label: 'DingTalk',
      order: 40,
      configPath: 'channels.dingtalk',
      actions: { 'setup.start': { result: 'qr' }, 'setup.manual': { result: 'form' } },
    });
    expect(paths).toContain('clientId');
    expect(paths).toContain('clientSecret');
    expect(paths).toContain('dmPolicy');
    expect(paths).toContain('groupPolicy');
  });
});

describe('ChannelsSettingsPanel simplified UX and one-click pairing', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  function ChannelRoute() {
    return <ChannelsSettingsPanel channelId={useParams().id} />;
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    useLocaleStore.setState({ language: 'en' });
    useGatewayStore.setState({ conversationId: 'fixture' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.resetAllMocks();
  });

  it('surfaces pending pairing badge on Hub card, approves in one click, and avoids duplicate credential inputs', async () => {
    const ch = messages('en').channelsSettings;
    let pendingList = [
      {
        senderId: 'user_9988',
        codeLast4: '4321',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      },
    ];
    const dingtalkEntry: ChannelCatalogEntry = {
      id: 'dingtalk',
      extensionId: 'dingtalk',
      source: 'bundled',
      label: 'DingTalk',
      order: 40,
      configPath: 'channels.dingtalk',
      configured: true,
      enabled: true,
      capabilities: { pairing: true },
      actions: {
        'setup.start': { label: 'Set up by QR', result: 'qr' },
        'setup.manual': { label: 'Enter credentials', result: 'form' },
      },
      configSchema: {
        type: 'object',
        required: ['clientId', 'clientSecret'],
        properties: {
          enabled: { type: 'boolean' },
          clientId: { type: 'string', title: 'Client ID' },
          clientSecret: { type: 'string', title: 'Client Secret', format: 'password' },
          dmPolicy: { type: 'string', enum: ['pairing', 'allowlist', 'open', 'disabled'], default: 'pairing' },
          allowFrom: { type: 'array', items: { type: 'string' } },
          groupPolicy: { type: 'string', enum: ['allowlist', 'open', 'disabled'], default: 'allowlist' },
          groupAllowFrom: { type: 'array', items: { type: 'string' } },
        },
      },
    };

    vi.mocked(fetchJson).mockImplementation(async (url) => {
      const pathname = new URL(url instanceof Request ? url.url : url).pathname;
      if (pathname === '/api/channels/catalog') {
        return { payload: { channels: [dingtalkEntry] } };
      }
      if (pathname === '/api/channels/status') {
        return { payload: { channels: [{ name: 'dingtalk', enabled: true, connected: true }] } };
      }
      if (pathname === '/api/channels/pairing/summary') {
        return { payload: { summary: { dingtalk: { pending: pendingList.length, stale: 0, atCapacity: false } } } };
      }
      if (pathname === '/api/channels/dingtalk/pairing') {
        return {
          payload: {
            channel: 'dingtalk',
            accountId: 'default',
            dmPolicy: 'pairing',
            pending: pendingList,
            paired: { fromConfig: [], fromCredentials: [] },
          },
        };
      }
      if (pathname === '/api/channels/dingtalk/config') {
        return { payload: { config: { enabled: true, clientId: 'bot-id', dmPolicy: 'pairing', groupPolicy: 'open' } } };
      }
      return { payload: {} };
    });

    const approveSpy = vi.fn();
    vi.mocked(apiFetch).mockImplementation(async (url, init) => {
      const pathname = new URL(url instanceof Request ? url.url : url).pathname;
      if (pathname === '/api/channels/dingtalk/pairing/approve-sender') {
        approveSpy(JSON.parse(String(init?.body)));
        pendingList = [];
        return Response.json({ ok: true, payload: { senderId: 'user_9988', alreadyPaired: false } });
      }
      return Response.json({ ok: true });
    });

    await act(async () => {
      root.render(
        <StrictMode>
          <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
            <MemoryRouter initialEntries={[CHANNELS_HUB_PATH]}>
              <Routes>
                <Route path={CHANNELS_HUB_PATH} element={<ChannelRoute />} />
                <Route path={CHANNELS_HUB_PATH + '/:id'} element={<ChannelRoute />} />
              </Routes>
            </MemoryRouter>
          </SWRConfig>
        </StrictMode>,
      );
    });

    expect(container.textContent).toContain('1 pending');
    const cardTrigger = [...container.querySelectorAll('button')].find(
      (el) => el.getAttribute('aria-label') === `DingTalk · ${ch.hubPairingButton}`,
    );
    expect(cardTrigger).toBeDefined();

    await act(async () => cardTrigger!.click());

    const modal = document.querySelector('[role="dialog"]')!;
    expect(modal).toBeTruthy();
    expect(modal.textContent).toContain('user_9988');
    // No duplicate Client ID / Client Secret fields leaked into raw SchemaForm
    expect(modal.textContent).not.toContain('Client Secret');

    const approveButton = [...modal.querySelectorAll('button')].find(
      (el) => el.textContent?.trim() === ch.pairingApprove,
    );
    expect(approveButton).toBeDefined();
    await act(async () => approveButton!.click());

    expect(approveSpy).toHaveBeenCalledWith({ accountId: 'default', senderId: 'user_9988' });
    expect(modal.textContent).not.toContain('user_9988');
  });
});

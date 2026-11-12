// @vitest-environment jsdom

import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { messages } from '@/i18n/messages';
import { apiFetch, fetchJson } from '@/lib/fetch';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import { CHANNELS_HUB_PATH } from '../channels-routes';
import { ChannelsSettingsPanel } from '../channels-settings-panel';
import type { ChannelCatalogEntry } from '../use-channel-catalog';

vi.mock('@/lib/fetch', () => ({ apiFetch: vi.fn(), fetchJson: vi.fn() }));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,fixture' } }));

const ch = messages('en').channelsSettings;

function ChannelRoute() {
  return <ChannelsSettingsPanel channelId={useParams().id} />;
}

function button(root: ParentNode, name: string) {
  const result = [...root.querySelectorAll('button')].find((element) =>
    element.textContent?.trim() === name || element.getAttribute('aria-label') === name,
  );
  expect(result, name).toBeDefined();
  return result!;
}

function dialog() {
  const result = document.querySelector('[role="dialog"]');
  expect(result).toBeTruthy();
  return result!;
}

function fill(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const cases = [
  { id: 'weixin', start: 'login.start', qr: true, fields: [] },
  { id: 'feishu', start: 'setup.start', qr: true, fields: ['appId', 'appSecret'] },
  { id: 'dingtalk', start: 'setup.start', qr: true, fields: ['clientId', 'clientSecret'] },
  { id: 'wecom', start: 'setup.start', qr: true, fields: ['botId', 'secret'] },
  { id: 'telegram', start: 'setup.start', qr: false, fields: ['botToken'] },
  { id: 'slack', start: 'setup.manual', qr: false, fields: ['botToken', 'appToken'] },
  { id: 'discord', start: 'setup.manual', qr: false, fields: ['botToken'] },
] as const;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let priorLanguage: ReturnType<typeof useLocaleStore.getState>['language'];
let priorConversationId: string | undefined;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  priorLanguage = useLocaleStore.getState().language;
  priorConversationId = useGatewayStore.getState().conversationId;
  useLocaleStore.setState({ language: 'en' });
  useGatewayStore.setState({ conversationId: 'fixture' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useLocaleStore.setState({ language: priorLanguage });
  useGatewayStore.setState({ conversationId: priorConversationId });
  vi.resetAllMocks();
});

async function openPanel() {
  await act(async () => root.render(
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
  ));
}

const flows = [
  ...cases.map((entry) => ({ ...entry, manual: entry.fields.length > 0 })),
  ...cases.filter((entry) => entry.qr && entry.fields.length).map((entry) => ({ ...entry, manual: false })),
];

it.each(flows)('$id completes quick setup (manual: $manual), then stops and resumes with saved credentials', async ({ id, start, qr, fields, manual }) => {
  let configured = false;
  let enabled = false;
  let showQr = qr;
  const form = {
    type: 'form', submitAction: id === 'telegram' ? 'setup.save' : 'setup.manual',
    ...(id === 'slack' ? { setupTemplate: { content: '{}', url: 'https://api.slack.com/apps' } } : {}),
    schema: {
      type: 'object', required: fields,
      properties: {
        ...Object.fromEntries(fields.map((field) => [field, {
          type: 'string', title: field,
          ...(field.endsWith('Token') || field.toLowerCase().endsWith('secret') ? { format: 'password' } : {}),
        }])),
        ...(id === 'slack' ? { proxy: { type: 'string', title: 'Proxy' } } : {}),
      },
    },
  };
  const entry: ChannelCatalogEntry = {
    id, label: id, extensionId: id, source: 'bundled', order: 0,
    configPath: 'channels.' + id, description: 'Messaging channel',
    actions: {
      [start]: { label: 'Start setup', result: qr ? 'qr' : 'form' },
      ...(qr && fields.length ? { 'setup.manual': { label: 'Manual setup', result: 'form' } } : {}),
      'doctor.run': { label: 'Diagnose', result: 'diagnostics' },
    },
  };
  vi.mocked(fetchJson).mockImplementation(async (url) => {
    switch (new URL(url instanceof Request ? url.url : url).pathname) {
      case '/api/channels/catalog': return { payload: { channels: [{ ...entry, configured, enabled }] } };
      case '/api/channels/status': return { payload: { channels: enabled ? [{ name: id, connected: true }] : [] } };
      default: return { payload: {} };
    }
  });
  const actions = vi.fn();
  const update = vi.fn();
  vi.mocked(apiFetch).mockImplementation(async (url, init) => {
    const path = new URL(url instanceof Request ? url.url : url).pathname;
    if (path === '/api/config' && init?.method === 'PATCH') {
      const patch = JSON.parse(String(init.body));
      update(patch);
      enabled = patch.channels[id].enabled;
      return Response.json({ ok: true });
    }
    if (!path.includes('/actions/')) return Response.json({ ok: true, payload: { agents: [] } });
    const action = path.split('/').at(-1)!;
    const input = JSON.parse(String(init?.body)).input;
    actions(action, input);
    if (qr && action === start && showQr) {
      return Response.json({ payload: {
        type: 'qr', conversationId: 'fixture-session', qrPayload: 'https://example.com/scan',
        statusAction: 'setup.status', cancelAction: 'setup.cancel', pollIntervalMs: 1000,
      } });
    }
    if (action === 'setup.cancel') return Response.json({ payload: { type: 'ok' } });
    if (action === 'setup.status' || fields.some((field) => input?.[field])) {
      configured = enabled = true;
      return Response.json({ payload: action === 'setup.status'
        ? { type: 'poll', phase: 'done', ok: true, configChanged: true }
        : { type: 'ok', configChanged: true } });
    }
    return Response.json({ payload: form });
  });

  await openPanel();
  expect(container.querySelector('[role="switch"]')).toBeNull();
  await act(async () => button(container, qr ? ch.scanToConnect : ch.connect).click());
  expect(actions).toHaveBeenCalledTimes(1);
  expect(actions.mock.calls[0][0]).toBe(start);
  expect(dialog().textContent).not.toContain(ch.messageHandling);
  expect(dialog().textContent).not.toContain(ch.diagnose);

  if (qr) {
    expect(dialog().querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,fixture');
    if (manual) {
      await act(async () => button(dialog(), ch.useSetupCredentials).click());
      expect(actions.mock.calls.slice(-2).map(([action]) => action)).toEqual(['setup.cancel', 'setup.manual']);
      showQr = false;
      await act(async () => button(dialog(), ch.scanToConnect).click());
      expect(actions.mock.calls.at(-1)?.[0]).toBe(start);
    } else {
      if (id === 'feishu') {
        await act(async () => button(dialog(), 'Platform').click());
        await act(async () => button(document, 'Lark').click());
        expect(actions.mock.calls.slice(-2)).toEqual([
          ['setup.cancel', { conversationId: 'fixture-session' }],
          ['setup.start', { domain: 'lark' }],
        ]);
      }
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1050)); });
      expect(actions.mock.calls.at(-1)?.[0]).toBe('setup.status');
      expect(dialog().textContent).toContain(ch.complete);
    }
  }

  if (manual) {
    const inputs = [...dialog().querySelectorAll<HTMLInputElement>('input')];
    expect(inputs).toHaveLength(fields.length);
    expect(button(dialog(), ch.verifyAndConnect).disabled).toBe(true);
    if (id === 'slack') expect(dialog().querySelector('details')?.open).toBe(false);
    await act(async () => inputs.forEach((input, index) => fill(input, 'fixture-' + fields[index])));
    await act(async () => button(dialog(), ch.verifyAndConnect).click());
    expect(actions.mock.calls.at(-1)?.[1]).toEqual(Object.fromEntries(fields.map((field) => [field, 'fixture-' + field])));
    expect(dialog().textContent).toContain(ch.setupSaved);
  }

  const settingsLabel = ch.channelSettingsLabel.replace('{{channel}}', id);
  await act(async () => button(dialog(), settingsLabel).click());
  expect(dialog().textContent).toContain(ch.messageHandling);
  await act(async () => button(dialog(), ch.toggleChannel.replace('{{channel}}', id)).click());
  expect(update).toHaveBeenLastCalledWith({ channels: { [id]: { enabled: false } } });
  await act(async () => button(dialog(), ch.close).click());
  const actionCount = actions.mock.calls.length;
  await act(async () => button(container, ch.enableChannel).click());
  expect(update).toHaveBeenLastCalledWith({ channels: { [id]: { enabled: true } } });
  expect(actions).toHaveBeenCalledTimes(actionCount);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(button(container, ch.testMessage).disabled).toBe(false);
});

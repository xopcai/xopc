// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { messages } from '@/i18n/messages';
import { apiFetch } from '@/lib/fetch';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';

import { ChannelSetupCard } from '../channel-setup-card';
import type { ChannelCatalogEntry } from '../use-channel-catalog';

vi.mock('@/lib/fetch', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/copy-to-clipboard', () => ({ copyTextToClipboard: vi.fn() }));

it('shows a single Slack setup action, a copyable App Manifest and two masked inputs', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const template = '{"settings":{"socket_mode_enabled":true}}';
  vi.mocked(apiFetch).mockResolvedValue(Response.json({ ok: true, payload: {
    type: 'form',
    submitAction: 'setup.manual',
    setupTemplate: { content: template, url: 'https://api.slack.com/apps' },
    schema: {
      type: 'object',
      required: ['botToken', 'appToken'],
      properties: {
        botToken: { type: 'string', format: 'password', title: 'Bot Token' },
        appToken: { type: 'string', format: 'password', title: 'App Token' },
      },
    },
  } }));
  vi.mocked(copyTextToClipboard).mockResolvedValue(true);
  const entry: ChannelCatalogEntry = {
    id: 'slack', label: 'Slack', configured: false, extensionId: 'slack',
    source: 'bundled', order: 60, configPath: 'channels.slack',
    actions: { 'setup.manual': { label: 'Configure Slack', result: 'form' } },
  };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(
      <ChannelSetupCard entry={entry} locale="en" messages={messages('en').channelsSettings} onChanged={() => {}} />,
    ));
    const buttons = () => [...container.querySelectorAll('button')];
    const setup = buttons().filter((button) => button.textContent === 'Configure Slack');
    expect(setup).toHaveLength(1);
    await act(async () => setup[0].click());
    expect(container.querySelector('textarea')?.value).toBe(template);
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(2);
    expect(container.querySelector('a')?.href).toBe('https://api.slack.com/apps');
    expect(buttons().find((button) => button.textContent === messages('en').channelsSettings.saveSetup)?.disabled).toBe(true);
    await act(async () => buttons().find((button) => button.textContent === 'Copy App Manifest')?.click());
    expect(copyTextToClipboard).toHaveBeenCalledWith(template);
    expect(container.textContent).toContain('Copied');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';

import { browserPreviewIce } from '../browser-preview-ice.js';

it('uses short-lived coturn credentials and leaves direct ICE available by default', () => {
  const secret = 'fixture-only';
  const env = {
    XOPC_BROWSER_PREVIEW_TURN_URLS: 'turn:localhost:3478?transport=udp,turns:localhost:5349?transport=tcp',
    XOPC_BROWSER_PREVIEW_TURN_SECRET: secret,
  };
  const ice = browserPreviewIce(env, 100_000);
  expect(ice.iceTransportPolicy).toBe('all');
  const server = ice.iceServers[0]!;
  expect(server.username.startsWith('700:')).toBe(true);
  expect(server.credential).toBe(createHmac('sha1', secret).update(server.username).digest('base64'));
  expect(browserPreviewIce({ ...env, XOPC_BROWSER_PREVIEW_FORCE_RELAY: '1' }).iceTransportPolicy).toBe('relay');
  expect(browserPreviewIce({ ...env, XOPC_BROWSER_PREVIEW_TURN_URLS: 'https://localhost' }).iceServers).toEqual([]);
});

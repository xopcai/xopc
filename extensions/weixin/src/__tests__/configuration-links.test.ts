import { expect, it } from 'vitest';

import { formatWeixinOutboundText } from '../outbound-send.js';
import { markdownToPlainText } from '../messaging/send.js';

it('preserves the actual secure setup URL through the production plain-text pipeline', () => {
  const url = 'https://gateway.example.com/#/mcp-setup/12345678-abcd';
  const text = formatWeixinOutboundText(`请通过[安全入口](${url})完成授权。`);
  expect(text).toContain(url);
  expect(text).toContain('安全入口');
  expect(markdownToPlainText('[服务](https://example.com/a__b?q=c__d)')).toContain('https://example.com/a__b?q=c__d');
});

it('does not turn unsafe, relative or credential-bearing anchors into clickable links', () => {
  for (const href of ['javascript:alert', 'data:text/html,unsafe', '/settings', 'https://secret:token@example.com']) {
    expect(markdownToPlainText(`[安全入口](${href})`)).toBe('安全入口');
  }
});

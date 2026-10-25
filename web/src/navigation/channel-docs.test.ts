import { expect, it } from 'vitest';
import { channelDocsUrl } from './index';
it('resolves channel paths to localized public documentation, never the workbench origin', () => {
  expect(channelDocsUrl('zh', '/channels/telegram')).toBe('https://xopcai.github.io/xopc/zh/channels/telegram');
  expect(channelDocsUrl('en', '/channels/telegram.md')).toBe('https://xopcai.github.io/xopc/channels/telegram');
  expect(channelDocsUrl('zh', '/zh/channels/telegram')).not.toContain('/zh/zh/');
  expect(channelDocsUrl('en', 'https://example.org/guide')).toBe('https://example.org/guide');
  expect(channelDocsUrl('en', 'javascript:alert(1)')).toBe('https://xopcai.github.io/xopc/');
});

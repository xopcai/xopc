import { describe, expect, it } from 'vitest';

import { findLatestBrowserSetupRequired } from '@/features/chat/tool-results/browser-setup-required-parser';

describe('findLatestBrowserSetupRequired', () => {
  it('returns only the latest browser setup request from a turn', () => {
    expect(findLatestBrowserSetupRequired([
      {
        type: 'tool_use',
        name: 'browser_use',
        details: { kind: 'browser_setup_required', hint: {
          driver: 'extension', reason: 'extension_not_installed',
          deepLink: '/settings/agent-browser?driver=extension',
        } },
      },
      { type: 'tool_use', name: 'read_file', details: {} },
      {
        type: 'tool_use',
        name: 'browser_use',
        details: { kind: 'browser_setup_required', hint: {
          driver: 'extension', reason: 'extension_not_connected',
          deepLink: '/settings/agent-browser?driver=extension',
        } },
      },
    ])).toMatchObject({
      driver: 'extension',
      reason: 'extension_not_connected',
    });
  });

  it('ignores unrelated and malformed tool details', () => {
    expect(findLatestBrowserSetupRequired([
      { type: 'text' },
      { type: 'tool_use', name: 'browser_use', details: { kind: 'other' } },
    ])).toBeNull();
  });
});

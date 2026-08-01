import { describe, expect, it } from 'vitest';

import { ConfigSchema, type Config } from '../../config/schema.js';
import {
  getComposioMemorySyncProfile,
  updateComposioMemorySyncProfile,
} from '../memory-sync-profile.js';

function gmailConfig(): Config {
  return {
    connectors: {
      instances: {
        'composio-gmail': {
          xopcConnector: {
            managed: true,
            enabled: true,
            connectorId: 'composio-gmail',
          },
          runtime: { type: 'composio', toolkit: 'gmail', role: 'toolkit' },
        },
      },
    },
  } as Config;
}

describe('Composio memory sync profiles', () => {
  it('persists a bounded curated read-only schedule in connector config', () => {
    const config = gmailConfig();

    const profile = updateComposioMemorySyncProfile(config, 'composio-gmail', {
      enabled: true,
      actionId: 'GMAIL_FETCH_EMAILS',
      arguments: { query: 'newer_than:7d' },
      agentId: 'main',
      connectionId: 'gmail-work',
      intervalMinutes: 1,
      triggerSync: true,
    });

    expect(profile.intervalMinutes).toBe(5);
    expect(getComposioMemorySyncProfile(config, 'composio-gmail')).toEqual(profile);
    expect(getComposioMemorySyncProfile(ConfigSchema.parse(config), 'composio-gmail')).toEqual(profile);
  });

  it('rejects write actions and sensitive persisted arguments', () => {
    const config = gmailConfig();
    const base = {
      enabled: true,
      arguments: {},
      agentId: 'main',
      intervalMinutes: 15,
      triggerSync: true,
    };

    expect(() => updateComposioMemorySyncProfile(config, 'composio-gmail', {
      ...base,
      actionId: 'GMAIL_SEND_EMAIL',
    })).toThrow(/read-only action/);
    expect(() => updateComposioMemorySyncProfile(config, 'composio-gmail', {
      ...base,
      actionId: 'GMAIL_FETCH_EMAILS',
      arguments: { apiKey: 'must-not-be-persisted' },
    })).toThrow(/sensitive field/);
  });
});

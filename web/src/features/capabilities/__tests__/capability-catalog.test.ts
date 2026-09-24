import { describe, expect, it } from 'vitest';

import {
  connectorCapabilityItems,
  extensionCapabilityItems,
  filterCapabilityCatalog,
  skillCapabilityItems,
} from '@/features/capabilities/capability-catalog';
import { CAPABILITY_SECTIONS, capabilityPath } from '@/features/capabilities/capabilities-page';
import type { ConnectorDefinition, ConnectorInstance } from '@/features/connectors/connectors-api';
import { agentsAppDetailPath } from '@/features/settings/agents/agents-app-path';
import { channelDetailPath } from '@/features/settings/channels/channels-routes';
import type { SkillCatalogEntry } from '@/features/skills/skill.types';

describe('capability catalog', () => {
  it('owns agent and channel management routes', () => {
    expect(CAPABILITY_SECTIONS).toEqual([
      'discover',
      'skills',
      'connectors',
      'channels',
      'agents',
      'extensions',
    ]);
    expect(capabilityPath('agents')).toBe('/capabilities/agents');
    expect(capabilityPath('channels')).toBe('/capabilities/channels');
    expect(agentsAppDetailPath('review agent')).toBe('/capabilities/agents/review%20agent');
    expect(channelDetailPath(' Telegram ')).toBe('/capabilities/channels/telegram');
  });

  it('normalizes skills and marks matching installed skills', () => {
    const items = skillCapabilityItems([
      {
        id: 'meeting-notes',
        name: 'Meeting Notes',
        type: 'skill',
        description: 'Summarize meetings',
        downloads: 12,
        author: { username: 'team', avatarUrl: null },
        updatedAt: '2026-01-01',
        branding: { iconUrl: 'https://store.example/skill.svg', iconSha256: 'skill-hash' },
      },
    ], [{ directoryId: 'meeting-notes', name: 'Meeting Notes' } as SkillCatalogEntry]);

    expect(items[0]).toMatchObject({ kind: 'skill', status: 'installed', source: 'team', iconUrl: 'https://store.example/skill.svg' });
  });

  it('deduplicates connector sources and exposes authorization problems', () => {
    const definition = {
      id: 'gmail', displayName: 'Gmail', description: 'Read mail', category: 'docs', kind: 'service', source: 'builtin', tags: [],
      branding: { logoUrl: '/connector-icons/gmail.svg', source: 'builtin' },
    } as unknown as ConnectorDefinition;
    const instance = { instanceId: 'gmail-main', connectorId: 'gmail', status: 'unauthorized' } as ConnectorInstance;
    const items = connectorCapabilityItems(
      [definition],
      [{ id: 'gmail', name: 'Gmail Store', type: 'connector', category: 'docs', description: '', downloads: 1, author: { username: 'xopc', avatarUrl: null }, updatedAt: 1 }],
      [instance],
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'gmail', status: 'attention', iconUrl: '/connector-icons/gmail.svg' });
    expect(items[0].href).toContain('instance=gmail-main');
  });

  it('filters across type and searchable metadata', () => {
    const items = extensionCapabilityItems([
      {
        id: 'calendar',
        name: 'Calendar',
        description: 'Schedule events',
        npmPackage: '@xopc/calendar',
        tags: ['planning'],
        branding: { iconUrl: 'https://store.example/calendar.svg', iconSha256: 'extension-hash' },
      },
    ], new Set());

    expect(filterCapabilityCatalog(items, 'extension', 'planning')).toHaveLength(1);
    expect(filterCapabilityCatalog(items, 'skill', 'planning')).toHaveLength(0);
    expect(items[0].iconUrl).toBe('https://store.example/calendar.svg');
  });

  it('uses Store branding directly for catalog connectors', () => {
    const items = connectorCapabilityItems([], [{
      id: 'sentry',
      name: 'Sentry',
      type: 'connector',
      category: 'code',
      description: 'Inspect errors',
      downloads: 3,
      author: { username: 'xopc', avatarUrl: null },
      updatedAt: 1,
      branding: { iconUrl: 'https://store.example/sentry.svg', iconSha256: 'connector-hash' },
    }], []);

    expect(items[0].iconUrl).toBe('https://store.example/sentry.svg');
  });
});

import { describe, expect, it } from 'vitest';

import {
  connectorCapabilityItems,
  extensionCapabilityItems,
  filterCapabilityCatalog,
  skillCapabilityItems,
} from '@/features/capabilities/capability-catalog';
import type { ConnectorDefinition, ConnectorInstance } from '@/features/connectors/connectors-api';
import type { SkillCatalogEntry } from '@/features/skills/skill.types';

describe('capability catalog', () => {
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
      },
    ], [{ directoryId: 'meeting-notes', name: 'Meeting Notes' } as SkillCatalogEntry]);

    expect(items[0]).toMatchObject({ kind: 'skill', status: 'installed', source: 'team' });
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
      { id: 'calendar', name: 'Calendar', description: 'Schedule events', npmPackage: '@xopc/calendar', tags: ['planning'] },
    ], new Set());

    expect(filterCapabilityCatalog(items, 'extension', 'planning')).toHaveLength(1);
    expect(filterCapabilityCatalog(items, 'skill', 'planning')).toHaveLength(0);
  });
});

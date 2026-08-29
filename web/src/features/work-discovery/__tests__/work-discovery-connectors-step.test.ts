import { describe, expect, it } from 'vitest';

import type { ConnectorDefinition } from '@/features/connectors/connectors-api';

import {
  mergeUnderstandingConnectors,
  ONBOARDING_CONNECTOR_FALLBACKS,
  sortUnderstandingConnectors,
} from '../work-discovery-connectors-step';

function connector(toolkit: string, understanding = true): ConnectorDefinition {
  return {
    id: `composio-${toolkit}`,
    version: 'test',
    displayName: toolkit,
    description: `${toolkit} connector`,
    category: 'automation',
    kind: 'composio',
    source: 'registry',
    capabilities: ['tools'],
    ...(understanding ? { understanding: { mode: 'activity', bootstrapWindowDays: 30, readOnly: true } } : {}),
    auth: { mode: 'oauth', provider: 'composio' },
    setup: {},
    runtime: { type: 'composio', toolkit, role: 'toolkit' },
  };
}

describe('work discovery connector ordering', () => {
  it('ships usable local definitions before the remote catalog is available', () => {
    expect(ONBOARDING_CONNECTOR_FALLBACKS).toHaveLength(5);
    expect(ONBOARDING_CONNECTOR_FALLBACKS.slice(0, 3).map((item) => item.id)).toEqual([
      'composio-gmail',
      'composio-googlecalendar',
      'composio-googledrive',
    ]);
    expect(ONBOARDING_CONNECTOR_FALLBACKS.every((item) => (
      item.source === 'registry'
      && item.auth.mode === 'oauth'
      && item.runtime.type === 'composio'
      && item.understanding != null
    ))).toBe(true);
  });

  it('shows Gmail, Google Calendar, and Google Drive as the first three common services', () => {
    const sorted = sortUnderstandingConnectors([
      connector('linear'),
      connector('github'),
      connector('googledrive'),
      connector('gmail'),
      connector('googlecalendar'),
      connector('slack', false),
    ]);

    expect(sorted.slice(0, 3).map((item) => item.id)).toEqual([
      'composio-gmail',
      'composio-googlecalendar',
      'composio-googledrive',
    ]);
    expect(sorted.map((item) => item.id)).not.toContain('composio-slack');
  });

  it('keeps local fallbacks while preferring richer remote definitions', () => {
    const remoteGmail = { ...connector('gmail'), displayName: 'Gmail from catalog' };
    const merged = mergeUnderstandingConnectors(ONBOARDING_CONNECTOR_FALLBACKS, [remoteGmail]);

    expect(merged).toHaveLength(5);
    expect(merged[0]?.displayName).toBe('Gmail from catalog');
    expect(merged.map((item) => item.id)).toContain('composio-linear');
  });
});

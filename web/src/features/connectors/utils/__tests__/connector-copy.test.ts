import { describe, expect, it } from 'vitest';

import { messages } from '@/i18n/messages';

import type { ConnectorDefinition } from '../../connectors-api';
import { connectorDescription } from '../connector-copy';

const gmail: ConnectorDefinition = {
  id: 'composio-gmail',
  version: '1.0.0',
  displayName: 'Gmail',
  description: 'Backend description',
  category: 'automation',
  kind: 'composio',
  source: 'registry',
  capabilities: ['tools'],
  tags: [],
  auth: { mode: 'oauth' },
  setup: {},
  runtime: { type: 'composio', toolkit: 'gmail', role: 'toolkit' },
};

describe('connectorDescription', () => {
  it('localizes known toolkit descriptions', () => {
    expect(connectorDescription(gmail, messages('zh').connectorsSettings)).toContain('Gmail 邮件');
  });

  it('keeps the catalog description for unknown toolkits', () => {
    const unknown = {
      ...gmail,
      runtime: { type: 'composio' as const, toolkit: 'unknown', role: 'toolkit' as const },
    };
    expect(connectorDescription(unknown, messages('zh').connectorsSettings)).toBe('Backend description');
  });
});

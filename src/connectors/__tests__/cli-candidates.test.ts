import { describe, expect, it } from 'vitest';

import { COMPOSIO_CONNECTORS } from '../composio.js';
import { connectionCandidates, resolveConnectionCandidate } from '../connection-candidates.js';

describe('connection discovery', () => {
  it('uses Store plugins instead of duplicate built-in connection candidates', () => {
    for (const query of ['Feishu', '飞书', '钉钉', '语雀', 'Notion', 'Todoist']) {
      expect(connectionCandidates(query)).toEqual([]);
    }
    expect(() => resolveConnectionCandidate('feishu-workspace')).toThrow();
    expect(connectionCandidates('wecom')).toEqual([]);
    expect(connectionCandidates('WPS 365')).toEqual([]);
    expect(() => resolveConnectionCandidate('wecom-workspace')).toThrow();
  });

  it('discovers every agent-ready Composio connector from the shared catalog', () => {
    for (const definition of COMPOSIO_CONNECTORS) {
      expect(connectionCandidates(`${definition.displayName} list my content`), definition.id)
        .toEqual(expect.arrayContaining([expect.objectContaining({ candidateRef: definition.id })]));
      expect(resolveConnectionCandidate(definition.id)).toMatchObject({
        target: { type: 'connector', connectorId: definition.id },
        label: definition.displayName,
      });
    }
  });

  it('uses a generic tool capability for catalog connectors without a specialized profile', () => {
    expect(resolveConnectionCandidate('composio-clickup').capabilities).toEqual(['tools']);
    expect(resolveConnectionCandidate('composio-stripe').capabilities).toEqual(['tools']);
  });
});

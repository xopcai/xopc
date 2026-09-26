import { describe, expect, it } from 'vitest';

import { COMPOSIO_CONNECTORS } from '../composio.js';
import { connectionCandidates, resolveConnectionCandidate } from '../connection-candidates.js';

describe('connection discovery', () => {
  it.each(['Feishu Lark docs list documents drive files', 'lark feishu drive file list', 'Lark', 'Feishu'])('discovers Feishu from English query %s', query => {
    expect(connectionCandidates(query)).toEqual(expect.arrayContaining([expect.objectContaining({ candidateRef: 'feishu-workspace' })]));
  });
  it('discovers authorization candidates without an existing account', () => {
    expect(connectionCandidates('使用飞书读取文档')).toEqual(expect.arrayContaining([expect.objectContaining({ candidateRef: 'feishu-workspace' })]));
    expect(connectionCandidates('wecom')).toEqual(expect.arrayContaining([expect.objectContaining({ candidateRef: 'wecom-workspace' })]));
    const candidate = resolveConnectionCandidate('feishu-workspace');
    expect(candidate.capabilities).toContain('docs.fetch');
    expect(candidate.capabilities).not.toContain('calendar.events.create');
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

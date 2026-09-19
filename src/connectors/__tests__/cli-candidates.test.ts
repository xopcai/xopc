import { describe, expect, it } from 'vitest';

import { connectionCandidates, resolveConnectionCandidate } from '../connection-candidates.js';

describe('CLI connection discovery', () => {
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
});

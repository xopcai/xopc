import { describe, expect, it } from 'vitest';

import { COMPOSIO_CONNECTORS } from '../composio.js';
import {
  connectionCandidateAlternatives,
  connectionCandidates,
  rankConnectionCandidatesByEcosystem,
  resolveConnectionCandidate,
} from '../connection-candidates.js';

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

  it('discovers bilingual domain candidates for generic calendar, email, tasks, and docs queries', () => {
    expect(connectionCandidates('帮我查一下今天的日程').map(c => c.candidateRef)).toEqual(
      expect.arrayContaining(['composio-googlecalendar', 'composio-outlook']),
    );
    expect(connectionCandidates('check my recent emails').map(c => c.candidateRef)).toEqual(
      expect.arrayContaining(['composio-gmail', 'composio-outlook']),
    );
    expect(connectionCandidates('看看我最近的待办任务').map(c => c.candidateRef)).toEqual(
      expect.arrayContaining(['composio-linear', 'composio-jira', 'composio-clickup']),
    );
    expect(connectionCandidates('帮我找一下云盘文档').map(c => c.candidateRef)).toEqual(
      expect.arrayContaining(['composio-googledrive', 'composio-one_drive', 'composio-dropbox']),
    );
  });

  it('discovers broader catalog connectors generically via catalog descriptions and bilingual hints', () => {
    expect(connectionCandidates('帮我查一下最近的发票和账单').map(c => c.candidateRef)).toContain('composio-stripe');
    expect(connectionCandidates('check my recent store orders').map(c => c.candidateRef)).toContain('composio-shopify');
    expect(connectionCandidates('看看客户商机列表').map(c => c.candidateRef)).toEqual(
      expect.arrayContaining(['composio-hubspot', 'composio-salesforce']),
    );
    expect(connectionCandidates('inspect playlists').map(c => c.candidateRef)).toEqual(
      expect.arrayContaining(['composio-spotify', 'composio-youtube']),
    );
  });

  it('does not falsely match generic Composio aliases when an explicit Store/external service is named', () => {
    expect(connectionCandidates('帮我查一下飞书日程')).toEqual([]);
    expect(connectionCandidates('查一下企微文档')).toEqual([]);
    expect(connectionCandidates('Notion 任务列表')).toEqual([]);
  });

  it('returns same-domain alternatives scoped by capability when available', () => {
    expect(connectionCandidateAlternatives('composio-gmail', ['email.read'])).toEqual([
      { candidateRef: 'composio-outlook', label: 'Outlook' },
    ]);
    expect(connectionCandidateAlternatives('composio-googlecalendar', ['calendar.read'])).toEqual([
      { candidateRef: 'composio-outlook', label: 'Outlook' },
    ]);
    expect(connectionCandidateAlternatives('composio-outlook', ['calendar.read'])).toEqual([
      { candidateRef: 'composio-googlecalendar', label: 'Google Calendar' },
    ]);
    expect(connectionCandidateAlternatives('composio-linear').map(item => item.candidateRef)).toEqual(
      expect.arrayContaining(['composio-jira', 'composio-asana', 'composio-clickup']),
    );
  });

  it('ranks active and same-ecosystem candidates ahead of unrelated defaults', () => {
    const calendarCandidates = connectionCandidates('查一下日程');
    const microsoftRanked = rankConnectionCandidatesByEcosystem(calendarCandidates, new Set(['composio-microsoft_teams']));
    expect(microsoftRanked[0]?.candidateRef).toBe('composio-outlook');

    const googleRanked = rankConnectionCandidatesByEcosystem(calendarCandidates, new Set(['composio-gmail']));
    expect(googleRanked[0]?.candidateRef).toBe('composio-googlecalendar');
  });
});

// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import type { SupportReport } from '../support-report-api';
import { startSupportInvestigationSession } from '../support-investigation-session';

const report: SupportReport = {
  schemaVersion: 1,
  title: '[Bug] Telegram does not reply',
  capturedAt: '2026-09-02T00:00:00.000Z',
  markdown: '# report',
  doctor: [],
  logs: [],
  redaction: { replacements: 1 },
};

describe('startSupportInvestigationSession', () => {
  it('creates a main-agent session, tags it, and starts the first investigation turn', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ session: { key: 'agent:main:webchat:default:direct:support-1' } })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });
    const getTurnClaim = vi.fn(async () => ({
      type: 'endpoint' as const,
      endpointId: 'desktop-1',
      token: 'a'.repeat(32),
    }));

    const sessionKey = await startSupportInvestigationSession(report, 'investigate this', {
      fetch: request as never,
      getTurnClaim,
      randomUUID: () => 'message-1',
    });

    expect(sessionKey).toBe('agent:main:webchat:default:direct:support-1');
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      channel: 'webchat',
      agentId: 'main',
    });
    expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toEqual(expect.objectContaining({
      tags: ['support'],
      customData: expect.objectContaining({ kind: 'support-investigation' }),
    }));
    const input = JSON.parse(String(request.mock.calls[2]?.[1]?.body));
    expect(input).toEqual(expect.objectContaining({
      clientMessageId: 'message-1',
      delivery: 'next',
      content: 'investigate this',
      origin: expect.objectContaining({ endpointId: 'desktop-1' }),
    }));
    expect(input.attachments).toEqual([expect.objectContaining({
      type: 'file',
      mimeType: 'text/markdown',
      name: 'xopc-diagnostics.md',
    })]);
    expect(atob(input.attachments[0].data)).toBe('# report');
  });
});

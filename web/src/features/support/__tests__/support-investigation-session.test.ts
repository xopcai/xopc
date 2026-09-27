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
    const request = vi.fn().mockResolvedValue({ ok: true });
    const create = vi.fn(async () => 'support-1');
    const send = vi.fn(async () => undefined);

    const conversationId = await startSupportInvestigationSession(report, 'investigate this', {
      fetch: request as never,
      create,
      send,
    });

    expect(conversationId).toBe('support-1');
    expect(create).toHaveBeenCalledOnce();
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual(expect.objectContaining({
      tags: ['support'],
      customData: expect.objectContaining({ kind: 'support-investigation' }),
    }));
    expect(send).toHaveBeenCalledWith('support-1', 'investigate this', [expect.objectContaining({
      type: 'file',
      mimeType: 'text/markdown',
      name: 'xopc-diagnostics.md',
    })]);
    expect(send.mock.invocationCallOrder[0]).toBeLessThan(request.mock.invocationCallOrder[0]);
  });
});

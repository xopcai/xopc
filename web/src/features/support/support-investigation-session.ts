import { SessionManager } from '@/features/chat/session/session-manager';
import { sendSessionInput } from '@/features/chat/session/send-session-input';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import type { SupportReport } from './support-report-api';

type StartSupportInvestigationDeps = {
  fetch?: typeof fetchJson;
  create?: () => Promise<string>;
  send?: typeof sendSessionInput;
};

function markdownAttachment(markdown: string) {
  const bytes = new TextEncoder().encode(markdown);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return {
    type: 'file',
    mimeType: 'text/markdown',
    data: btoa(binary),
    name: 'xopc-diagnostics.md',
    size: bytes.byteLength,
  };
}

export async function startSupportInvestigationSession(
  report: SupportReport,
  investigationPrompt: string,
  deps: StartSupportInvestigationDeps = {},
): Promise<string> {
  const request = deps.fetch ?? fetchJson;
  const conversationId = deps.create ? await deps.create() : (await new SessionManager().createSession({ agentId: 'main' })).key;
  await (deps.send ?? sendSessionInput)(conversationId, investigationPrompt, [markdownAttachment(report.markdown)]);

  await request(apiUrl(`/api/sessions/${encodeURIComponent(conversationId)}`), {
    method: 'PATCH',
    body: JSON.stringify({
      name: report.title,
      tags: ['support'],
      replaceTags: true,
      customData: {
        kind: 'support-investigation',
        supportReportCapturedAt: report.capturedAt,
      },
    }),
  }).catch(() => undefined);

  return conversationId;
}

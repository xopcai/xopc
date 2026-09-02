import { waitForEndpointTurnClaim } from '@/features/endpoint-tools/turn-claim';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import type { SupportReport } from './support-report-api';

type StartSupportInvestigationDeps = {
  fetch?: typeof fetchJson;
  getTurnClaim?: typeof waitForEndpointTurnClaim;
  randomUUID?: () => string;
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
  const getTurnClaim = deps.getTurnClaim ?? waitForEndpointTurnClaim;
  const randomUUID = deps.randomUUID ?? (() => crypto.randomUUID());
  const created = await request<{ session: { key: string } }>(apiUrl('/api/sessions'), {
    method: 'POST',
    body: JSON.stringify({ channel: 'webchat', agentId: 'main' }),
  });
  const sessionKey = created.session.key.trim();
  if (!sessionKey) throw new Error('Session create did not return a session key');

  await request(apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}`), {
    method: 'PATCH',
    body: JSON.stringify({
      name: report.title,
      tags: ['support'],
      replaceTags: true,
      customData: {
        genericNewChatShell: true,
        kind: 'support-investigation',
        supportReportCapturedAt: report.capturedAt,
      },
    }),
  }).catch(() => undefined);

  const origin = await getTurnClaim();
  await request(apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}/inputs`), {
    method: 'POST',
    body: JSON.stringify({
      clientMessageId: randomUUID(),
      delivery: 'next',
      content: investigationPrompt,
      attachments: [markdownAttachment(report.markdown)],
      origin,
    }),
  });
  return sessionKey;
}

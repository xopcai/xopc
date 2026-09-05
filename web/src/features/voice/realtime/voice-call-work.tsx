import { useRef, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { ClarifyPrompt } from '@/features/chat/composer/clarify-prompt';
import { getFriendlyToolTitle } from '@/features/chat/messages/tool-friendly-title';
import { listConnectorApprovals, respondConnectorApproval } from '@/features/connectors/connectors-api';
import type { ChatMessages } from '@/i18n/messages';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';

import type { UseRealtimeVoiceReturn } from './use-realtime-voice';

export function VoiceCallWork({ voice, sessionKey, m }: { voice: UseRealtimeVoiceReturn; sessionKey: string; m: ChatMessages }) {
  const token = useGatewayStore((state) => state.token);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const approvals = useSWR(token ? ['voice-approvals', sessionKey, token] : null, () => listConnectorApprovals(), { refreshInterval: 3_000 });
  const scopedApprovals = approvals.data?.filter((approval) => approval.sessionKey === sessionKey) ?? [];
  const run = async (action: () => Promise<unknown>) => {
    if (submitting.current) return;
    submitting.current = true; setPending(true); setError(null);
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { submitting.current = false; setPending(false); }
  };
  const answer = (text: string, skip = false) => {
    const requestId = voice.clarification?.requestId;
    if (!requestId) return;
    return run(async () => {
      await fetchJson(apiUrl(`/api/clarify/${encodeURIComponent(requestId)}`), { method: 'POST', body: JSON.stringify(skip ? { skip: true } : { answer: text }) });
      voice.dismissClarification(requestId);
    });
  };
  return <div className="space-y-3 text-sm">
    {voice.activities.map((activity) => <p key={activity.toolCallId} className="text-xs text-fg-muted">{getFriendlyToolTitle(activity.toolName, {
      searchedWeb: m.stepSearchedWeb, searchedMemory: m.stepSearchedMemory, searchedCode: m.stepSearchedCode,
      readFile: m.stepReadFile, runCommand: m.stepRunCommand, listDirectory: m.stepListDirectory,
      writeFile: m.stepWriteFile, editFile: m.stepEditFile, openUrl: m.stepOpenUrl,
      fetchUrl: m.stepFetchUrl, unknownTool: m.stepUnknownTool,
    })} · {activity.status === 'running' ? m.callWorking : activity.status === 'failed' ? m.callWorkFailed : m.callWorkDone}</p>)}
    <ClarifyPrompt prompt={voice.clarification} labels={m} submitting={pending} submitError={error} onSubmit={(text) => answer(text)} onCancel={() => answer('', true)} />
    {scopedApprovals.map((approval) => <div key={approval.id} className="space-y-2 rounded-lg border border-edge p-3">
      <p className="font-medium">{m.callApproval}</p><p>{approval.actionId}</p>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(approval.argumentsPreview, null, 2)}</pre>
      <div className="flex gap-2">{(['denied', 'approved'] as const).map((decision) => <Button key={decision} variant="secondary" disabled={pending} onClick={() => void run(async () => { await respondConnectorApproval(approval.id, decision); await approvals.mutate(); })}>{decision === 'approved' ? m.callApprove : m.callDeny}</Button>)}</div>
    </div>)}
    {error && !voice.clarification ? <p role="alert" className="text-xs text-red-600">{error}</p> : null}
  </div>;
}

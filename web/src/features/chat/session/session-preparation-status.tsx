import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { sessionPreparationViewSchema } from '@xopcai/gateway-contract';
import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { readLocalSessionDraft } from './local-session-drafts';

export function SessionPreparationStatus({ conversationId }: { conversationId: string | null }) {
  const scope = useGatewayStore(state => state.conversationId);
  const language = useLocaleStore(state => state.language);
  const zh = language.startsWith('zh');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const state = useSWR(conversationId ? ['session-preparation', scope, conversationId] : null, async () => {
    const draft = await readLocalSessionDraft(conversationId!);
    if (draft && !draft.materialization) return null;
    const result = await fetchJson<{ payload: { preparation?: unknown } }>(apiUrl(`/api/sessions/${encodeURIComponent(conversationId!)}/input-state`));
    return result.payload.preparation ? sessionPreparationViewSchema.parse(result.payload.preparation) : null;
  }, { refreshInterval: data => data?.state === 'preparing' ? 5000 : 0, shouldRetryOnError: false });
  const { mutate } = state;
  useEffect(() => {
    const update = (event: Event) => {
      if ((event as CustomEvent<{ conversationId?: string }>).detail?.conversationId === conversationId) void mutate();
    };
    window.addEventListener('session-input-state', update);
    return () => window.removeEventListener('session-input-state', update);
  }, [conversationId, mutate]);
  const preparation = state.data;
  if (!preparation || preparation.state === 'ready') return null;
  const retry = async () => {
    setBusy(true); setError('');
    try {
      const response = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(conversationId!)}/preparation/retry`), {
        method: 'POST', body: JSON.stringify({ operationId: preparation.operationId, expectedRevision: preparation.revision,
          idempotencyKey: `${preparation.operationId}:${preparation.revision}` }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await mutate();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <div className="border-b border-edge-subtle px-3 py-2 text-sm text-fg-muted" role="status">
    <span>{preparation.state === 'preparing' ? (zh ? '正在准备会话环境…' : 'Preparing conversation environment…')
      : preparation.lastError ?? (zh ? '会话环境准备失败' : 'Conversation environment preparation failed')}</span>
    {preparation.state === 'preparation_failed' ? <button type="button" className="ml-2 text-accent-fg" disabled={busy} onClick={() => void retry()}>{zh ? '重试准备' : 'Retry preparation'}</button> : null}
    {error ? <span role="alert" className="ml-2">{error}</span> : null}
  </div>;
}

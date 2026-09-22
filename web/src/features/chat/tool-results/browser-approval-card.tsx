import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';
import { useGatewayStore } from '@/stores/gateway-store';

import { parseBrowserApprovalState, type BrowserApproval } from './browser-approval';

export function BrowserApprovalCard({ approval, conversationId }: { approval: BrowserApproval; conversationId?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const generation = useRef(0);
  const namespace = useGatewayStore(state => state.conversationId);
  const gateway = useGatewayStore(state => state.baseUrl);
  useEffect(() => {
    pending.current = false; setBusy(false); setFailed(false);
    return () => { generation.current += 1; };
  }, [approval.id, conversationId, namespace, gateway]);
  const language = useLocaleStore((state) => state.language);
  const text = language === 'zh'
    ? { title: '浏览器操作需要确认', risk: '风险', deny: '拒绝', approve: '仅批准本次', approved: '已批准本次操作，请让助手继续。', denied: '已拒绝。', consumed: '本次批准已使用。', expired: '本次请求已过期，请让助手重新发起。', error: '无法确认当前审批状态，请重新检查。', retry: '重新检查' }
    : { title: 'Browser action needs approval', risk: 'Risk', deny: 'Deny', approve: 'Approve once', approved: 'Approved once. Ask the agent to continue.', denied: 'Denied.', consumed: 'This approval has been used.', expired: 'This request expired. Ask the agent to request approval again.', error: 'Could not verify approval status. Check again.', retry: 'Check again' };
  const { data, error, isLoading, mutate } = useSWR(
    conversationId && namespace ? ['browser-approval', gateway, namespace, conversationId, approval.id] : null,
    async () => {
      const result = await fetchJson<{ approvals: unknown[] }>(apiUrl(`/api/browser/approvals?conversationId=${encodeURIComponent(conversationId!)}`));
      const found = result.approvals.map(parseBrowserApprovalState).find(item => item?.id === approval.id && item.conversationId === conversationId);
      if (!found) throw new Error('Approval unavailable');
      return found;
    },
    { refreshInterval: current => current?.status === 'pending' || current?.status === 'approved' ? 10000 : 0 },
  );
  useEffect(() => {
    if (!data || !['pending', 'approved'].includes(data.status)) return;
    const delay = Date.parse(data.expiresAt) - Date.now();
    if (delay <= 0) return;
    const timeout = window.setTimeout(() => { void mutate(); }, delay + 1);
    return () => window.clearTimeout(timeout);
  }, [data, mutate]);
  const status = data && Date.parse(data.expiresAt) <= Date.now()
    && ['pending', 'approved'].includes(data.status) ? 'expired' : data?.status;

  async function respond(decision: 'approved' | 'denied') {
    if (pending.current || !data || status !== 'pending' || Date.parse(data.expiresAt) <= Date.now()) return;
    pending.current = true; setBusy(true); setFailed(false);
    const current = generation.current;
    const isCurrent = () => current === generation.current && useGatewayStore.getState().conversationId === namespace
      && useGatewayStore.getState().baseUrl === gateway;
    try {
      const result = await fetchJson<{ approval: unknown }>(apiUrl('/api/browser/approvals/respond'), {
        method: 'POST',
        body: JSON.stringify({ id: approval.id, decision }),
      });
      const decided = parseBrowserApprovalState(result.approval);
      if (!decided || decided.id !== approval.id || decided.conversationId !== conversationId) throw new Error('Invalid approval response');
      if (!isCurrent()) return;
      await mutate(decided, { revalidate: false });
    } catch {
      if (!isCurrent()) return;
      setFailed(true);
      void mutate();
    } finally { if (isCurrent()) { pending.current = false; setBusy(false); } }
  }

  return (
    <section className="mt-2 rounded-xl border border-edge bg-surface-panel p-3 text-sm">
      <div className="font-medium text-fg">{text.title}</div>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">{data?.summary ?? approval.summary}</p>
      <p className="mt-1 text-xs text-fg-muted">{text.risk}: {(data?.risk ?? approval.risk).replace('_', ' ')}</p>
      {isLoading ? <Skeleton className="mt-3 h-8 w-full" /> : error || failed || !data ? <div className="mt-2">
        <p role="alert" className="text-xs text-danger">{text.error}</p>
        <Button className="mt-2 h-8 text-xs" disabled={busy || !conversationId || !namespace} onClick={() => { setFailed(false); void mutate(); }}>{text.retry}</Button>
      </div> : status === 'pending' ? (
        <div className="mt-3 flex justify-end gap-2">
          <Button className="h-8 text-xs" disabled={busy} onClick={() => void respond('denied')}>{text.deny}</Button>
          <Button variant="primary" className="h-8 text-xs" disabled={busy} onClick={() => void respond('approved')}>{text.approve}</Button>
        </div>
      ) : (
        <p role="status" className="mt-2 text-xs text-fg-muted">
          {status ? text[status] : text.error}
        </p>
      )}
    </section>
  );
}

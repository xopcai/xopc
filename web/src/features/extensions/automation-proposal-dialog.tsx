import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import useSWR from 'swr';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export function AutomationProposalDialog({ extensionId, proposalId, zh, onClose }: {
  extensionId: string; proposalId: string; zh: boolean; onClose: () => void;
}) {
  const url = `/api/extensions/${encodeURIComponent(extensionId)}/automation-proposals/${encodeURIComponent(proposalId)}`;
  const { data, error, isLoading } = useSWR(url, path => fetchJson<{
    proposal: { digest: string; status: string; decision?: { approve: boolean; enable: boolean } }; definition?: Record<string, unknown>; before?: Record<string, unknown>;
    simulation?: { triggerSummary: string; actionSummary: string; safetyNotes: string[]; requiredConfirmations: string[] };
  }>(apiUrl(path)));
  const [enable, setEnable] = useState(false), [busy, setBusy] = useState(false), [failure, setFailure] = useState('');
  const decide = async (approve: boolean) => {
    if (!data) return;
    setBusy(true); setFailure('');
    try { await fetchJson(apiUrl(`${url}/review`), { method: 'POST', body: JSON.stringify({ digest: data.proposal.digest, approve, enable: approve && (data.proposal.decision?.enable ?? enable) }) }); onClose(); }
    catch (error) { setFailure(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <Dialog.Root open onOpenChange={open => { if (!open && !busy) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-[130] bg-scrim" />
    <Dialog.Content className="fixed left-1/2 top-1/2 z-[131] flex h-[min(720px,calc(100vh-32px))] w-[min(42rem,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay p-5">
      <Dialog.Title className="text-base font-semibold text-fg">{zh ? '审核应用提出的自动化' : 'Review app automation proposal'}</Dialog.Title>
      <Dialog.Description className="mt-2 text-sm text-fg-muted">{zh ? '只有你在宿主中确认，才会创建或修改自动化。关闭此窗口不会批准提案。' : 'Only your confirmation here creates or changes an automation. Closing this window grants nothing.'}</Dialog.Description>
      <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto text-sm text-fg">
        {isLoading ? <Skeleton className="h-48" /> : error ? <p role="alert">{zh ? '无法读取提案，请重新打开或检查授权。' : 'Could not load proposal. Reopen or check authorization.'}</p> : data ? <>
          <p>{zh ? '状态' : 'Status'}: {data.proposal.status}</p>
          {data.proposal.decision ? <p>{zh ? '审核正在应用；重试将核对原操作结果。' : 'Review is being applied; retry to reconcile the original operation.'}</p> : null}
          {data.simulation ? <><p>{data.simulation.triggerSummary}</p><p>{data.simulation.actionSummary}</p>
            {[...data.simulation.safetyNotes, ...data.simulation.requiredConfirmations].map((note, i) => <p key={i} className="text-warning">{note}</p>)}</> : null}
          {data.before ? <details><summary>{zh ? '变更前的完整配置' : 'Full configuration before change'}</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(data.before, null, 2)}</pre></details> : null}
          {data.definition ? <details open><summary>{zh ? '待采用的完整配置' : 'Full proposed configuration'}</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(data.definition, null, 2)}</pre></details> : null}
          {data.proposal.status === 'pending' ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={Boolean(data.proposal.decision)} checked={data.proposal.decision?.enable ?? enable} onChange={event => setEnable(event.target.checked)} />{zh ? '采用后启用。计划将由宿主持续管理，可能调用工具、产生费用或对外发送结果；不会受应用手动运行的次数预算约束。' : 'Enable after adoption. The host will manage this schedule independently; it may use tools, incur costs or send results. App manual-run budgets do not limit this adopted schedule.'}</label> : null}
        </> : null}
      </div>
      {failure ? <p role="alert" className="mt-2 text-xs text-danger">{failure}</p> : null}
      <div className="mt-4 flex justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-edge px-3 py-2">{zh ? '关闭' : 'Close'}</button>
        <button type="button" disabled={busy || !data || Boolean(data.proposal.decision) || data.proposal.status !== 'pending'} onClick={() => void decide(false)} className="rounded-lg border border-edge px-3 py-2">{zh ? '拒绝提案' : 'Reject proposal'}</button>
        <button type="button" disabled={busy || !data || data.proposal.status !== 'pending'} onClick={() => void decide(true)} className="rounded-lg bg-accent px-3 py-2 text-on-accent">{zh ? '确认采用' : 'Approve proposal'}</button></div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

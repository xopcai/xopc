import { useState } from 'react';
import useSWR from 'swr';
import type { SpaceWorkbookCellChange } from '@xopcai/gateway-contract';

import { Skeleton } from '@/components/ui/skeleton';

import { getWorkbookProposal, submitWorkbookAction } from './space-api';

function ChangedCells({ items }: { items: SpaceWorkbookCellChange[] }) {
  return <ul className="space-y-1">
    {items.map(cell => <li key={`${cell.sheetId}:${cell.cell}`} className="grid grid-cols-[minmax(7rem,1fr)_2fr] gap-2 text-xs">
      <span className="truncate font-medium" title={`${cell.sheetName}!${cell.cell}`}>{cell.sheetName}!{cell.cell}</span>
      <span className="min-w-0 break-words"><span className="text-fg-muted">{cell.beforeFormula ?? String(cell.before ?? '—')}</span>
        <span aria-hidden> → </span>{cell.afterFormula ?? String(cell.after ?? '—')}</span>
    </li>)}
  </ul>;
}

export function WorkbookReview({ id, versionId, proposalId, undo, zh, onClose, onComplete }: {
  id: string; versionId: string; proposalId?: string; undo?: string; zh: boolean; onClose(): void; onComplete(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const proposal = useSWR(proposalId ? ['workbook-proposal', id, proposalId] : null, () => getWorkbookProposal(id, proposalId!), { shouldRetryOnError: false });
  const saved = Boolean(proposal.data?.appliedVersionId);
  async function apply() {
    setBusy(true);
    setError('');
    try {
      if (proposal.data) await submitWorkbookAction(id, { action: 'apply', proposalId: proposal.data.proposalId });
      else if (undo) await submitWorkbookAction(id, { action: 'undo', versionId, sourceVersionId: undo });
      onComplete();
    } catch (cause) {
      setError((cause as { status?: number })?.status === 409
        ? (zh ? '工作簿已有更新，请在最新版本重新检查。' : 'The workbook has changed. Review the latest version and try again.')
        : (zh ? '操作未完成，请重试。' : 'Could not complete the action. Try again.'));
    } finally { setBusy(false); }
  }

  return <section aria-label={zh ? '工作簿修改' : 'Workbook changes'} className="max-h-[38%] shrink-0 overflow-y-auto border-b border-edge-subtle bg-surface-panel px-4 py-3">
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="me-auto text-sm font-semibold">{undo ? (zh ? '撤销这次修改' : 'Undo this change')
        : saved ? (zh ? '本次已保存的修改' : 'Saved changes') : (zh ? '审阅修改' : 'Review changes')}</h3>
      <button type="button" onClick={onClose} className="min-h-8 rounded-lg px-2 text-xs text-fg-muted hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent">{zh ? '关闭' : 'Close'}</button>
      {undo || (proposal.data && !saved) ? <button type="button" onClick={() => void apply()} disabled={busy}
        className="min-h-8 rounded-lg bg-accent px-2.5 text-xs font-medium text-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">
        {undo ? (zh ? '撤销修改' : 'Undo change') : (zh ? '应用并保存新版本' : 'Apply and save a new version')}
      </button> : null}
    </div>
    {undo ? <p className="mt-2 text-xs text-fg-muted">{zh ? '恢复修改前的内容，并保留两个历史版本。' : 'Restore the previous contents and keep both versions in history.'}</p> : null}
    {proposal.isLoading ? <Skeleton className="mt-2 h-8" /> : null}
    {proposal.data ? <div className="mt-2 space-y-2">
      <ChangedCells items={proposal.data.changes} />
      {proposal.data.effects.length ? <><h4 className="text-xs text-fg-muted">{zh ? '公式重算结果' : 'Recalculated results'}</h4><ChangedCells items={proposal.data.effects} /></> : null}
    </div> : null}
    {error || proposal.error ? <p role="alert" className="mt-2 text-xs text-danger">{error || (zh ? '该建议已过期或不可用。' : 'This proposal has expired or is unavailable.')}</p> : null}
  </section>;
}

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';

type BrowserApproval = {
  id: string;
  risk: 'external_effect' | 'destructive' | 'sensitive';
  summary: string;
  expiresAt: string;
};

export function parseBrowserApproval(details: unknown): BrowserApproval | null {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const record = details as Record<string, unknown>;
  if (record.kind !== 'browser_approval_required') return null;
  const error = record.error && typeof record.error === 'object' && !Array.isArray(record.error)
    ? record.error as Record<string, unknown>
    : null;
  const approval = error?.approval && typeof error.approval === 'object' && !Array.isArray(error.approval)
    ? error.approval as Record<string, unknown>
    : null;
  if (!approval || typeof approval.id !== 'string' || typeof approval.summary !== 'string' || typeof approval.expiresAt !== 'string') return null;
  if (!['external_effect', 'destructive', 'sensitive'].includes(String(approval.risk))) return null;
  return approval as BrowserApproval;
}

export function BrowserApprovalCard({ approval }: { approval: BrowserApproval }) {
  const [status, setStatus] = useState<'pending' | 'approved' | 'denied' | 'error'>('pending');
  const language = useLocaleStore((state) => state.language);
  const text = language === 'zh'
    ? { title: '浏览器操作需要确认', risk: '风险', deny: '拒绝', approve: '仅批准本次', approved: '已批准本次操作，请让助手继续。', denied: '已拒绝。', error: '无法记录本次决定。' }
    : { title: 'Browser action needs approval', risk: 'Risk', deny: 'Deny', approve: 'Approve once', approved: 'Approved once. Ask the agent to continue.', denied: 'Denied.', error: 'Could not record the decision.' };

  async function respond(decision: 'approved' | 'denied') {
    try {
      await fetchJson(apiUrl('/api/browser/approvals/respond'), {
        method: 'POST',
        body: JSON.stringify({ id: approval.id, decision }),
      });
      setStatus(decision);
    } catch {
      setStatus('error');
    }
  }

  return (
    <section className="mt-2 rounded-xl border border-edge bg-surface-panel p-3 text-sm">
      <div className="font-medium text-fg">{text.title}</div>
      <p className="mt-1 text-sm text-fg">{approval.summary}</p>
      <p className="mt-1 text-xs text-fg-muted">{text.risk}: {approval.risk.replace('_', ' ')}</p>
      {status === 'pending' ? (
        <div className="mt-3 flex justify-end gap-2">
          <Button className="h-8 text-xs" onClick={() => void respond('denied')}>{text.deny}</Button>
          <Button variant="primary" className="h-8 text-xs" onClick={() => void respond('approved')}>{text.approve}</Button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-fg-muted">
          {status === 'approved' ? text.approved : status === 'denied' ? text.denied : text.error}
        </p>
      )}
    </section>
  );
}

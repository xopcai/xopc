export type BrowserApproval = {
  id: string;
  risk: 'external_effect' | 'destructive' | 'sensitive';
  summary: string;
  expiresAt: string;
};

export type BrowserApprovalState = BrowserApproval & {
  conversationId: string;
  status: 'pending' | 'approved' | 'denied' | 'consumed' | 'expired';
};

export function parseBrowserApprovalState(value: unknown): BrowserApprovalState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const approval = value as Record<string, unknown>;
  if (typeof approval.id !== 'string' || !approval.id || typeof approval.conversationId !== 'string'
    || typeof approval.summary !== 'string' || typeof approval.expiresAt !== 'string' || !Number.isFinite(Date.parse(approval.expiresAt))
    || !['external_effect', 'destructive', 'sensitive'].includes(String(approval.risk))
    || !['pending', 'approved', 'denied', 'consumed', 'expired'].includes(String(approval.status))) return null;
  return approval as BrowserApprovalState;
}

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

import { apiFetch } from '../api/client';

export type AgentJudgment = {
  id: string;
  status: 'unread' | 'read' | 'snoozed' | 'resolved';
  updatedAt: string;
  insight: {
    title: string;
    summary: string;
    whyNow: string;
    impact: string;
    workDone: string;
    recommendation: string;
    urgency: 'low' | 'medium' | 'high' | 'critical';
    decision?: { question: string; options: Array<{ id: string; label: string; consequence: string }> };
  };
};

export async function fetchAgentJudgments(): Promise<AgentJudgment[]> {
  const response = await apiFetch('/api/inbox/judgments?limit=20');
  if (!response.ok) throw new Error(`Failed to fetch judgments: ${response.status}`);
  const body = await response.json() as { items?: AgentJudgment[] };
  return (body.items ?? []).filter((item) => item.status === 'unread' || item.status === 'read');
}

export async function decideAgentJudgment(itemId: string, choice: string): Promise<void> {
  const response = await apiFetch(`/api/inbox/judgments/${encodeURIComponent(itemId)}/decisions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ choice }),
  });
  if (!response.ok) throw new Error(`Failed to save decision: ${response.status}`);
}

export async function transitionAgentJudgment(itemId: string, action: 'snoozed' | 'resolved'): Promise<void> {
  const body = action === 'snoozed'
    ? { status: action, snoozedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }
    : { status: action, resolution: 'dismissed' };
  const response = await apiFetch(`/api/inbox/judgments/${encodeURIComponent(itemId)}/transition`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Failed to update judgment: ${response.status}`);
}

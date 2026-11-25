import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type ProactiveTier = 'tier_s_chat' | 'tier_a_inbox' | 'tier_b_digest' | 'tier_c_silent';
export type ProactiveCategory =
  | 'blocker'
  | 'prepared_draft'
  | 'meeting_prep'
  | 'folder_insight'
  | 'skill_candidate'
  | 'pulse_digest'
  | 'info';

export type ProactiveItemState =
  | 'buffered_digest'
  | 'ready'
  | 'delivered'
  | 'acted'
  | 'snoozed'
  | 'muted'
  | 'stale'
  | 'expired';

export interface ProactiveProposedAction {
  kind: 'approve_draft' | 'create_task' | 'adopt_rsi_candidate' | 'acknowledge';
  safetyMode: 'ask_before_apply';
  label: string;
  targetRef?: string;
  parameters?: Record<string, unknown>;
}

export interface PreparedScoutPackage {
  verifiedFacts: string[];
  evidenceRefs: string[];
  preparedDraft?: string;
  proposedAction?: ProactiveProposedAction;
}

export interface ProactiveExecutedActionReceipt {
  kind: 'create_task' | 'approve_draft' | 'adopt_rsi_candidate';
  taskId?: string;
  candidateId?: string;
  summary: string;
  executedAt: number;
}

export interface ProactiveHumanResolution {
  action: 'approve' | 'edit_and_approve' | 'move_to_digest' | 'snooze' | 'mute_rule';
  idempotencyKey: string;
  resolvedAt: number;
  originalDraft?: string;
  editedDraft?: string;
  muteMode?: 'drop' | 'digest_only';
  senderOrSubjectFilter?: string;
  note?: string;
  executedAction?: ProactiveExecutedActionReceipt;
}

export interface ProactiveItem {
  id: string;
  ownerId: string;
  agentId: string;
  coalesceKey: string;
  sourceEventIds: string[];
  tier: ProactiveTier;
  category: ProactiveCategory;
  title: string;
  summary: string;
  provenance: {
    source: string;
    eventType: string;
    trust: 'system' | 'user' | 'connector' | 'untrusted_webhook';
    coalescedCount: number;
    subscriptionId?: string;
    matchedProjectId?: string;
    matchedThreadId?: string;
    reason: string;
    evidenceRefs: string[];
    score: {
      actionability: number;
      urgency: number;
      novelty: number;
      preparedness: number;
      disruptionPenalty: number;
      netScore: number;
    };
  };
  preparedPayload?: PreparedScoutPackage;
  proposedAction?: ProactiveProposedAction;
  state: ProactiveItemState;
  digestBatchId?: string;
  conversationEntryId?: string;
  humanResolution?: ProactiveHumanResolution;
  validUntil: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProactiveHubMetrics {
  activeSubscriptions: number;
  bufferingSignals: number;
  droppedSignalsTotal: number;
  inboxPendingCount: number;
  chatEscalatedCount: number;
  digestBufferedCount: number;
  actedCount: number;
  mutedCount: number;
}

export type ProactiveResolutionRequest =
  | { action: 'approve'; idempotencyKey: string; note?: string }
  | { action: 'edit_and_approve'; idempotencyKey: string; editedDraft: string; note?: string }
  | { action: 'move_to_digest'; idempotencyKey: string }
  | { action: 'snooze'; idempotencyKey: string; untilMs: number }
  | { action: 'mute_rule'; idempotencyKey: string; mode: 'drop' | 'digest_only'; senderOrSubjectFilter?: string };

export interface RsiCapabilityCandidate {
  id: string;
  artifactKind: 'skill' | 'routine_method' | 'filter_rule';
  targetId: string;
  baseVersion?: number;
  scopeType: 'project' | 'workspace' | 'agent' | 'global';
  scopeId?: string;
  triggerKind: 'recovered_failure' | 'human_edit_diff' | 'repeated_pattern' | 'triage_mute';
  sourceRefs: string[];
  simRationale: {
    problemPattern: string;
    whyChanged: string;
    applicabilityConditions: string[];
    negativeConstraints: string[];
  };
  verificationStatus: 'pending' | 'running' | 'passed' | 'failed';
  status: 'staged' | 'inbox_pending' | 'adopted' | 'rejected' | 'rolled_back';
  adoptedVersion?: number;
  createdAt: number;
  updatedAt: number;
}

export async function fetchProactiveInbox(includeActed = false, limit = 20): Promise<{
  items: ProactiveItem[];
  metrics: ProactiveHubMetrics;
}> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (includeActed) query.set('includeActed', 'true');
  const res = await fetchJson<{ ok: true; payload: { items: ProactiveItem[]; metrics: ProactiveHubMetrics } }>(
    apiUrl(`/api/proactive/inbox?${query}`),
  );
  return res.payload;
}

export async function actOnProactiveItem(
  itemId: string,
  resolution: ProactiveResolutionRequest,
): Promise<ProactiveItem> {
  const res = await fetchJson<{ ok: true; payload: ProactiveItem }>(
    apiUrl(`/api/proactive/inbox/${encodeURIComponent(itemId)}/act`),
    {
      method: 'POST',
      body: JSON.stringify(resolution),
    },
  );
  return res.payload;
}

export async function fetchProactiveDigests(): Promise<{
  digests: ProactiveItem[];
  bufferedCount: number;
}> {
  const res = await fetchJson<{ ok: true; payload: { digests: ProactiveItem[]; bufferedCount: number } }>(
    apiUrl('/api/proactive/digests'),
  );
  return res.payload;
}

export async function flushProactiveDigest(windowLabel?: string): Promise<ProactiveItem | null> {
  const res = await fetchJson<{ ok: true; payload: { digest: ProactiveItem | null } }>(
    apiUrl('/api/proactive/digests/flush'),
    {
      method: 'POST',
      body: JSON.stringify(windowLabel ? { windowLabel } : {}),
    },
  );
  return res.payload.digest;
}

export async function fetchRsiCandidates(limit = 20): Promise<RsiCapabilityCandidate[]> {
  const res = await fetchJson<{ ok: true; payload: RsiCapabilityCandidate[] }>(
    apiUrl(`/api/rsi/candidates?limit=${limit}`),
  );
  return res.payload;
}

export async function adoptRsiCandidate(candidateId: string): Promise<RsiCapabilityCandidate> {
  const res = await fetchJson<{ ok: true; payload: RsiCapabilityCandidate }>(
    apiUrl(`/api/rsi/candidates/${encodeURIComponent(candidateId)}/adopt`),
    { method: 'POST' },
  );
  return res.payload;
}

export async function rejectRsiCandidate(candidateId: string): Promise<RsiCapabilityCandidate> {
  const res = await fetchJson<{ ok: true; payload: RsiCapabilityCandidate }>(
    apiUrl(`/api/rsi/candidates/${encodeURIComponent(candidateId)}/reject`),
    { method: 'POST' },
  );
  return res.payload;
}

export async function rollbackRsiCandidate(candidateId: string): Promise<RsiCapabilityCandidate> {
  const res = await fetchJson<{ ok: true; payload: RsiCapabilityCandidate }>(
    apiUrl(`/api/rsi/candidates/${encodeURIComponent(candidateId)}/rollback`),
    { method: 'POST' },
  );
  return res.payload;
}

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import type { Focus, FocusActivity, FocusCandidate, FocusInsight, FocusMonitorKind, FocusStatus } from './types';

export async function fetchFocuses(statuses: FocusStatus[] = ['active', 'paused']): Promise<Focus[]> {
  const query = encodeURIComponent(statuses.join(','));
  const result = await fetchJson<{ ok: true; focuses: Focus[] }>(apiUrl(`/api/focuses?status=${query}`));
  return result.focuses;
}

export async function fetchFocus(id: string): Promise<Focus> {
  const result = await fetchJson<{ ok: true; focus: Focus }>(apiUrl(`/api/focuses/${encodeURIComponent(id)}`));
  return result.focus;
}

export async function updateFocus(id: string, input: { title?: string; summary?: string; status?: FocusStatus }): Promise<Focus> {
  const result = await fetchJson<{ ok: true; focus: Focus }>(apiUrl(`/api/focuses/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return result.focus;
}

export async function deleteFocus(id: string): Promise<void> {
  await fetchJson(apiUrl(`/api/focuses/${encodeURIComponent(id)}`), { method: 'DELETE' });
}

export async function configureFocusMonitor(id: string, kind: FocusMonitorKind, enabled: boolean): Promise<Focus> {
  await fetchJson(apiUrl(`/api/focuses/${encodeURIComponent(id)}/monitors/${kind}`), {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
  return fetchFocus(id);
}

export async function runFocusMonitor(id: string, kind: FocusMonitorKind): Promise<void> {
  await fetchJson(apiUrl(`/api/focuses/${encodeURIComponent(id)}/monitors/${kind}/run`), { method: 'POST' });
}

export async function fetchFocusActivities(id: string): Promise<FocusActivity[]> {
  const result = await fetchJson<{ ok: true; activities: FocusActivity[] }>(apiUrl(`/api/focuses/${encodeURIComponent(id)}/activities?limit=100`));
  return result.activities;
}

export async function fetchFocusInsights(id: string): Promise<FocusInsight[]> {
  const result = await fetchJson<{ ok: true; insights: FocusInsight[] }>(apiUrl(`/api/focuses/${encodeURIComponent(id)}/insights?limit=50`));
  return result.insights;
}

export async function handleFocusInsight(focusId: string, insightId: string, action: 'dismiss' | 'investigate'): Promise<void> {
  await fetchJson(apiUrl(`/api/focuses/${encodeURIComponent(focusId)}/insights/${encodeURIComponent(insightId)}/${action}`), { method: 'POST' });
}

export async function fetchFocusCandidates(): Promise<FocusCandidate[]> {
  const result = await fetchJson<{ ok: true; candidates: FocusCandidate[] }>(apiUrl('/api/focus-candidates'));
  return result.candidates;
}

export async function respondToFocusCandidate(id: string, action: 'accept' | 'dismiss'): Promise<Focus | null> {
  const result = await fetchJson<{ ok: true; focus?: Focus }>(apiUrl(`/api/focus-candidates/${encodeURIComponent(id)}/${action}`), { method: 'POST' });
  return result.focus ?? null;
}

import {
  MobileUnderstandingItemSchema,
  MobileUnderstandingPageSchema,
  MobileUserUnderstandingSummarySchema,
  type MobileUnderstandingFilter,
  type MobileUnderstandingItem,
  type MobileUnderstandingPage,
  type MobileUserGoal,
  type MobileUserUnderstandingSummary,
} from '@xopcai/gateway-contract';

import { apiFetch, formatApiHttpError } from '../api/client';

async function parsedJson(response: Response): Promise<unknown> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const record = payload && typeof payload === 'object' ? payload as { error?: unknown } : {};
    const message = typeof record.error === 'string'
      ? record.error
      : record.error && typeof record.error === 'object' && typeof (record.error as { message?: unknown }).message === 'string'
        ? String((record.error as { message: string }).message) : undefined;
    throw new Error(formatApiHttpError(response.status, response.statusText, message));
  }
  return payload;
}

export async function fetchUserProfileSummary(): Promise<MobileUserUnderstandingSummary> {
  return MobileUserUnderstandingSummarySchema.parse(await parsedJson(await apiFetch('/api/user-model/mobile-summary')));
}

export async function fetchUnderstandingPage(
  filter: MobileUnderstandingFilter,
  cursor?: string,
): Promise<MobileUnderstandingPage> {
  const query = new URLSearchParams({ view: 'mobile', filter, limit: '20' });
  if (cursor) query.set('cursor', cursor);
  return MobileUnderstandingPageSchema.parse(
    await parsedJson(await apiFetch(`/api/user-model/assertions?${query.toString()}`)),
  );
}

export async function fetchUnderstandingItem(id: string): Promise<MobileUnderstandingItem> {
  const payload = await parsedJson(await apiFetch(`/api/user-model/assertions/${encodeURIComponent(id)}`));
  const assertion = payload && typeof payload === 'object' ? (payload as { assertion?: unknown }).assertion : undefined;
  return MobileUnderstandingItemSchema.parse(assertion);
}

export async function updateUserProfile(profile: MobileUserUnderstandingSummary['profile']): Promise<void> {
  await parsedJson(await apiFetch('/api/user-model/profile', { method: 'PATCH', body: JSON.stringify(profile) }));
}

export type MobileGoalEditStatus = 'proposed' | 'active' | 'paused' | 'achieved' | 'abandoned';

export async function createUserGoal(input: {
  title: string; desiredOutcome: string; targetAt?: number;
}): Promise<void> {
  await parsedJson(await apiFetch('/api/user-model/goals', {
    method: 'POST', body: JSON.stringify({ ...input, scope: { type: 'global' } }),
  }));
}

export async function updateUserGoal(id: string, input: {
  title: string; desiredOutcome: string; targetAt: number | null; status: MobileGoalEditStatus;
}): Promise<void> {
  await parsedJson(await apiFetch(`/api/user-model/goals/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify(input),
  }));
}

export async function updateUnderstanding(id: string, statement: string): Promise<void> {
  await parsedJson(await apiFetch(`/api/user-model/assertions/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify({ statement }),
  }));
}

export async function deleteUnderstanding(id: string): Promise<void> {
  await parsedJson(await apiFetch(`/api/user-model/assertions/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}

export async function updateMemorySettings(
  input: Partial<MobileUserUnderstandingSummary['settings']>,
): Promise<void> {
  await parsedJson(await apiFetch('/api/user-model/settings', {
    method: 'PATCH',
    body: JSON.stringify(input),
  }));
}

export type { MobileUnderstandingFilter, MobileUnderstandingItem, MobileUserGoal, MobileUserUnderstandingSummary };

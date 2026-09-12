import type { ProactiveCard, ProactivePreferences, ProactiveSubscriptionSettings } from '@xopcai/gateway-contract';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export interface ProactiveTemplate {
  calendarSource?: { status: string; lastSyncedAt: string | null };
  key: string; title: string; description: string; scopeKind: 'project' | 'workspace'; scheduled: boolean; requiresCalendar: boolean;
}
export interface ProactiveSubscription extends ProactiveSubscriptionSettings {
  id: string; scenarioKey: string; scopeKind: 'project' | 'workspace'; scopeId: string; enabled: boolean; revision: number; managed: boolean;
  schedule: { nextDueAt: string; lastCheckedAt?: string } | null;
}
export type PreferencesResponse = { preferences: ProactivePreferences };
export type CardsResponse = { cards: ProactiveCard[]; nextCursor: string | null };
export const proactiveGet = <T,>(path: string) => fetchJson<T>(apiUrl(path));
export const proactiveWrite = <T,>(path: string, method: string, body: unknown) => fetchJson<T>(apiUrl(path), { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

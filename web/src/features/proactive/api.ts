import type { ProactiveCard, ProactivePreferences, ProactiveSubscriptionSettings } from '@xopcai/gateway-contract';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export interface ProactiveTemplate {
  calendarSource?: { status: string; lastSourceUpdatedAt: string | null };
  key: string; title: string; description: string; scopeKind: 'project' | 'workspace'; scheduled: boolean; requiresCalendar: boolean;
}
export interface ProactiveSubscription extends ProactiveSubscriptionSettings {
  id: string; scenarioKey: string; scopeKind: 'project' | 'workspace'; scopeId: string; enabled: boolean; revision: number;
  schedule: { nextDueAt: string; lastCheckedAt?: string } | null;
}
export type PreferencesResponse = { preferences: ProactivePreferences };
export type CardsResponse = { cards: ProactiveCard[]; nextCursor: string | null };
export interface Delegation extends ProactiveSubscription {
  effectiveEnabled: boolean;
  project: { name: string; status: string } | null;
  latestRun: { status: string; reason: string | null; startedAt: string; completedAt: string | null; error: string | null } | null;
  pending: boolean;
}
export interface MailFollowUp {
  id: string; subscriptionId: string; instructions: string; dueAt: string; status: 'watching' | 'paused' | 'completed';
  revision: number; lastCheckedAt: string | null; sessionKey: string | null; sourceAvailable: boolean; enabled: boolean;
  subject: string | null; latestMessageAt: string | null; latestDirection: 'sent' | 'received' | 'unknown' | null;
  lastSyncedAt: string | null; syncFailed: boolean;
}
export interface ProactiveOverview {
  followUps: MailFollowUp[];
  needsDecision: ProactiveCard[];
  prepared: ProactiveCard[];
  updates: ProactiveCard[];
  delegations: Delegation[];
}
export const proactiveGet = <T,>(path: string) => fetchJson<T>(apiUrl(path));
export const proactiveWrite = <T,>(path: string, method: string, body: unknown) => fetchJson<T>(apiUrl(path), { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

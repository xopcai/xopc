import type { ProactiveCard, ProactivePreferences, ProactiveCheckStatus } from '@xopcai/gateway-contract';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type PreferencesResponse = { preferences: ProactivePreferences };
export type CardsResponse = { cards: ProactiveCard[]; nextCursor: string | null };
export interface Delegation {
  id: string; scenarioKey: string; scopeKind: 'project' | 'workspace'; scopeId: string; enabled: boolean; revision: number;
  delivery: 'inbox' | 'important' | 'digest'; completedAt: string | null; userInstructions: string; updatedAt: string;
  effectiveEnabled: boolean;
  scanIntervalMinutes: number;
  checkStatus: ProactiveCheckStatus;
  project: { name: string; status: string } | null;
  projectMonitoring: { mode: 'observe' | 'ask_before_action' | 'auto_low_risk'; allowedActions: string[] } | null;
  checking: boolean;
}
export interface MailFollowUp {
  id: string; subscriptionId: string; instructions: string; dueAt: string; status: 'watching' | 'paused' | 'completed';
  revision: number; lastCheckedAt: string | null; conversationId: string | null; sourceAvailable: boolean; enabled: boolean;
  subject: string | null; latestMessageAt: string | null; latestDirection: 'sent' | 'received' | 'unknown' | null;
  lastSyncedAt: string | null; syncFailed: boolean; sourceFresh: boolean;
}
export type ProactiveSceneKind = 'project_momentum' | 'meeting_preparation' | 'communication_follow_up';
export type ProactiveSceneStatus = 'needs_decision' | 'prepared' | 'changed' | 'following';
export interface ProactiveSceneMoment {
  id: string;
  kind: ProactiveSceneKind;
  status: ProactiveSceneStatus;
  title: string;
  promise: string;
  moment: string;
  relevance: string;
  help: string;
  arrangementId: string;
  manageRoute: string;
  object: { label: string; route: string } | null;
  card: ProactiveCard | null;
  updatedAt: string;
}
export interface HeartbeatOverview {
  enabled: boolean; checksAllowed: boolean; nextCheckAt: string | null;
  recent: Array<{ id: string; startedAt: string; completedAt: string | null; status: string; detail: string | null; content: string | null; deliveryStatus: string; target: string | null; chatId: string | null }>;
}
export interface ProactiveOverview {
  heartbeat: HeartbeatOverview | null;
  scenes: ProactiveSceneMoment[];
  followUps: MailFollowUp[];
  delegations: Delegation[];
}
export const proactiveGet = <T,>(path: string) => fetchJson<T>(apiUrl(path));
export const proactiveWrite = <T,>(path: string, method: string, body: unknown) => fetchJson<T>(apiUrl(path), { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

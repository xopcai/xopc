import { createHash } from 'node:crypto';

import type { HomeEvidence } from '@xopcai/gateway-contract';
import type { Task } from '@xopcai/gateway-contract';

import type { KnowledgeItem, KnowledgeReadPolicy } from '../knowledge-memory/domain.js';
import { knowledgeItemAllowed } from '../knowledge-memory/repository.js';
import type { Project } from '../projects/types.js';
import type { SessionMetadata } from '../session/types.js';
import type { HomeSuccessfulPattern } from './strategy.js';

export interface HomeContextSnapshot {
  generatedAt: number;
  locale: 'en' | 'zh';
  projects: Array<Pick<Project, 'id' | 'name' | 'status' | 'health' | 'brief' | 'outcome' | 'successCriteria' | 'targetAt' | 'updatedAt'>>;
  tasks: Array<Pick<Task, 'id' | 'projectId' | 'title' | 'phase' | 'priority' | 'dueAt' | 'updatedAt'> & { objective?: string }>;
  knowledge: Array<Pick<KnowledgeItem, 'id' | 'kind' | 'content' | 'scope' | 'updatedAt' | 'expiresAt' | 'validTo'> & {
    sourceType: Extract<HomeEvidence['sourceType'], 'calendar' | 'mail' | 'communication' | 'user_model'>;
    provider?: string;
  }>;
  recentSessions: Array<{ id: string; title: string; projectId?: string; updatedAt: number }>;
  successfulPatterns: HomeSuccessfulPattern[];
  evidence: HomeEvidence[];
  hash: string;
}

export interface HomeSnapshotSources {
  projects(): Project[];
  tasks(): Task[];
  knowledge(): KnowledgeItem[];
  knowledgePolicy?(): KnowledgeReadPolicy;
  sessions?(): SessionMetadata[];
}

function contentHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function knowledgeSourceType(item: KnowledgeItem): Extract<HomeEvidence['sourceType'], 'calendar' | 'mail' | 'communication' | 'user_model'> {
  if (item.recordClass !== 'source_index') return 'user_model';
  const identity = [item.source.provider, item.source.kind, item.source.sourceInstanceId]
    .filter((value): value is string => typeof value === 'string')
    .join(':')
    .toLocaleLowerCase();
  if (identity.includes('calendar')) return 'calendar';
  if (/gmail|outlook|\bmail\b/.test(identity)) return 'mail';
  if (/slack|teams|dingtalk|wecom|feishu|lark/.test(identity)) return 'communication';
  return 'user_model';
}

function knowledgeFreshUntil(item: HomeContextSnapshot['knowledge'][number], now: number): number {
  const ttl = item.sourceType === 'calendar'
    ? 6 * 60 * 60_000
    : item.sourceType === 'mail' || item.sourceType === 'communication'
      ? 12 * 60 * 60_000
      : 24 * 60 * 60_000;
  return Math.min(item.expiresAt ?? Number.MAX_SAFE_INTEGER, item.validTo ?? Number.MAX_SAFE_INTEGER, now + ttl);
}

export class HomeSnapshotBuilder {
  constructor(private readonly sources: HomeSnapshotSources) {}

  build(input: { now: number; locale: 'en' | 'zh'; successfulPatterns?: HomeSuccessfulPattern[] }): HomeContextSnapshot {
    const projects = this.sources.projects()
      .filter((project) => project.status === 'active' || project.status === 'planned' || project.status === 'paused')
      .sort((left, right) => (right.lastActiveAt ?? right.updatedAt) - (left.lastActiveAt ?? left.updatedAt))
      .slice(0, 8)
      .map(({ id, name, status, health, brief, outcome, successCriteria, targetAt, updatedAt }) => ({
        id, name, status, health, brief, outcome, successCriteria, targetAt, updatedAt,
      }));
    const projectIds = new Set(projects.map((project) => project.id));
    const tasks = this.sources.tasks()
      .filter((task) => task.phase !== 'closed' && (!task.projectId || projectIds.has(task.projectId)))
      .sort((left, right) => (left.dueAt ?? Number.MAX_SAFE_INTEGER) - (right.dueAt ?? Number.MAX_SAFE_INTEGER)
        || right.updatedAt - left.updatedAt)
      .slice(0, 30)
      .map(({ id, projectId, title, phase, priority, dueAt, updatedAt, contract }) => ({
        id, projectId, title, phase, priority, dueAt, updatedAt, objective: contract?.objective,
      }));
    const knowledgePolicy = this.sources.knowledgePolicy?.();
    const knowledge = this.sources.knowledge()
      .filter((item) => item.status === 'active'
        && (!item.expiresAt || item.expiresAt > input.now)
        && (!item.validTo || item.validTo > input.now)
        && (!knowledgePolicy || knowledgeItemAllowed(item, knowledgePolicy))
        && (item.scope.type !== 'project' || (item.scope.id && projectIds.has(item.scope.id))))
      .sort((left, right) => right.importance - left.importance || right.updatedAt - left.updatedAt)
      .slice(0, 30)
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        content: item.content,
        scope: item.scope,
        updatedAt: item.updatedAt,
        expiresAt: item.expiresAt,
        validTo: item.validTo,
        sourceType: knowledgeSourceType(item),
        ...(typeof item.source.provider === 'string' ? { provider: item.source.provider } : {}),
      }));
    const recentSessions = (this.sources.sessions?.() ?? [])
      .filter((session) => session.messageCount > 0)
      .map((session) => ({
        id: session.key,
        title: session.name?.trim() || (input.locale === 'zh' ? '未命名会话' : 'Untitled conversation'),
        projectId: session.projectId,
        updatedAt: Date.parse(session.lastInteractionAt ?? session.updatedAt),
      }))
      .filter((session) => Number.isFinite(session.updatedAt))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 12);

    const evidence: HomeEvidence[] = [
      ...projects.map((project): HomeEvidence => ({
        id: `project:${project.id}:v${project.updatedAt}`,
        sourceType: 'project',
        sourceRef: project.id,
        revision: String(project.updatedAt),
        observation: [project.name, project.outcome || project.brief].filter(Boolean).join('：').slice(0, 1_000),
        observedAt: project.updatedAt,
        freshUntil: input.now + 24 * 60 * 60_000,
        href: `/projects/${encodeURIComponent(project.id)}`,
      })),
      ...tasks.map((task): HomeEvidence => ({
        id: `task:${task.id}:v${task.updatedAt}`,
        sourceType: 'task',
        sourceRef: task.id,
        revision: String(task.updatedAt),
        observation: [task.title, task.objective].filter(Boolean).join('：').slice(0, 1_000),
        observedAt: task.updatedAt,
        freshUntil: input.now + 12 * 60 * 60_000,
        href: `/tasks?task=${encodeURIComponent(task.id)}`,
      })),
      ...knowledge.map((item): HomeEvidence => ({
        id: `knowledge:${item.id}:v${item.updatedAt}`,
        sourceType: item.sourceType,
        sourceRef: item.id,
        revision: String(item.updatedAt),
        observation: item.content.slice(0, 1_000),
        observedAt: item.updatedAt,
        freshUntil: knowledgeFreshUntil(item, input.now),
        ...(item.provider
          ? { href: `/connectors?connector=${encodeURIComponent(item.provider)}` }
          : item.scope.type === 'project' && item.scope.id
          ? { href: `/projects/${encodeURIComponent(item.scope.id)}` }
          : {}),
      })),
      ...recentSessions.map((session): HomeEvidence => ({
        id: `conversation:${session.id}:v${session.updatedAt}`,
        sourceType: 'conversation',
        sourceRef: session.id,
        revision: String(session.updatedAt),
        observation: session.title.slice(0, 1_000),
        observedAt: session.updatedAt,
        freshUntil: input.now + 12 * 60 * 60_000,
        href: `/chat/${encodeURIComponent(session.id)}`,
      })),
    ];
    const successfulPatterns = [...(input.successfulPatterns ?? [])]
      .filter((item) => item.successCount > 0)
      .sort((left, right) => right.successCount - left.successCount || left.outcome.localeCompare(right.outcome))
      .slice(0, 20);
    const stableContent = { locale: input.locale, projects, tasks, knowledge, recentSessions, successfulPatterns };
    return {
      generatedAt: input.now,
      locale: input.locale,
      projects,
      tasks,
      knowledge,
      recentSessions,
      successfulPatterns,
      evidence,
      hash: contentHash(stableContent),
    };
  }
}

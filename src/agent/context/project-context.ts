import { GoalService, type GoalWithDetails } from '../../goals/index.js';
import { LocalAppStore } from '../../local-apps/store.js';
import {
  getProjectForSession,
  getProjectWorkspacePathForSession,
} from '../../projects/workspace.js';
import type { Project } from '../../projects/types.js';
import { ProjectStore } from '../../projects/project-store.js';
import { listMemoryRecords, searchMemoryRecords } from '../../storage/sqlite/index.js';
import { sanitizeForPromptLiteral } from '../prompt/sanitize-for-prompt.js';

const MAX_TEXT = 1200;
const MAX_GOALS = 5;
const MAX_SESSIONS = 5;
const MAX_RECENT_MEMORY = 5;
const MAX_RELEVANT_MEMORY = 5;
const MAX_MEMORY = 8;

interface ProjectMemoryRecord {
  id: string;
  kind: string;
  content: string;
  updatedAt: string;
}

function truncateText(value: string | undefined, max = MAX_TEXT): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}...`;
}

function formatGoal(goal: GoalWithDetails): string {
  const parts = [`- ${sanitizeForPromptLiteral(goal.title)}`, `status=${goal.status}`, `priority=${goal.priority}`];
  if (goal.nextAction?.trim()) {
    parts.push(`next=${sanitizeForPromptLiteral(truncateText(goal.nextAction, 200) ?? '')}`);
  }
  if (goal.blockedReason?.trim()) {
    parts.push(`blocked=${sanitizeForPromptLiteral(truncateText(goal.blockedReason, 200) ?? '')}`);
  }
  return parts.join(' | ');
}

function selectProjectMemoryRecords(input: {
  recent: ProjectMemoryRecord[];
  relevant: ProjectMemoryRecord[];
}): ProjectMemoryRecord[] {
  const selected = new Map<string, ProjectMemoryRecord>();
  for (const record of [...input.relevant, ...input.recent]) {
    if (!selected.has(record.id)) selected.set(record.id, record);
    if (selected.size >= MAX_MEMORY) break;
  }
  return [...selected.values()];
}

export function buildActiveProjectContextForPrompt(
  sessionKey: string,
  options: { memoryQuery?: string } = {},
): string | undefined {
  const project = getProjectForSession(sessionKey);
  if (!project) return undefined;
  const localAppStore = new LocalAppStore();
  const localApp = localAppStore.findByProjectId(project.id);
  const latestAcceptance = localApp ? localAppStore.listAcceptanceRuns(localApp.id, 1)[0] : undefined;
  return formatActiveProjectContextForPrompt({
    project,
    workspacePath: getProjectWorkspacePathForSession(sessionKey) ?? project.workspaceRoot,
    activeGoals: new GoalService().list({
      projectId: project.id,
      status: ['active', 'paused', 'blocked', 'needs_input'],
      limit: MAX_GOALS,
    }),
    recentSessions: new ProjectStore().getRecentSessions(project.id, MAX_SESSIONS),
    memoryRecords: selectProjectMemoryRecords({
      relevant: options.memoryQuery?.trim()
        ? searchMemoryRecords({
            query: options.memoryQuery,
            projectId: project.id,
            statuses: ['active'],
            maxResults: MAX_RELEVANT_MEMORY,
          }).map((result) => result.record)
        : [],
      recent: listMemoryRecords({
        projectId: project.id,
        status: 'active',
        limit: MAX_RECENT_MEMORY,
      }),
    }),
    localApp: localApp ? {
      extensionId: localApp.extensionId,
      draftVersion: localApp.draftVersion,
      activeVersion: localApp.activeVersion,
      installationState: localApp.installationState,
      enabled: localApp.enabled,
      retainedVersions: localAppStore.listReleases(localApp.id).map((release) => release.version),
      latestAcceptance: latestAcceptance ? {
        status: latestAcceptance.status,
        sourceHash: latestAcceptance.sourceHash,
        failures: latestAcceptance.checks
          .filter((check) => check.status === 'failed')
          .map((check) => check.message),
        createdAt: latestAcceptance.createdAt,
      } : undefined,
    } : undefined,
  });
}

export function formatActiveProjectContextForPrompt(input: {
  project: Project;
  workspacePath?: string;
  activeGoals: GoalWithDetails[];
  recentSessions: Array<{ key: string; name?: string; updatedAt: string; agentId: string }>;
  memoryRecords?: Array<{ kind: string; content: string; updatedAt: string }>;
  localApp?: {
    extensionId: string;
    draftVersion: number;
    activeVersion?: number;
    installationState: 'not_installed' | 'installed';
    enabled: boolean;
    retainedVersions: number[];
    latestAcceptance?: {
      status: 'passed' | 'failed';
      sourceHash: string;
      failures: string[];
      createdAt: number;
    };
  };
}): string {
  const lines: string[] = [
    '# Active Project',
    '',
    `Project: ${sanitizeForPromptLiteral(input.project.name)}`,
    `Status: ${input.project.status}`,
  ];

  const workspace = input.workspacePath?.trim();
  if (workspace) {
    lines.push(`Workspace root: ${sanitizeForPromptLiteral(workspace)}`);
    lines.push('This project session uses the project workspace. Do not switch working directories unless the user moves the session to another project.');
  }

  const brief = truncateText(input.project.brief ?? input.project.description);
  if (brief) {
    lines.push('', '## Brief', brief);
  }

  const instructions = truncateText(input.project.instructions);
  if (instructions) {
    lines.push(
      '',
      '## Project Instructions',
      'Follow these project-level instructions unless they conflict with higher-priority system, developer, safety, or direct user instructions.',
      instructions,
    );
  }

  if (input.localApp) {
    const retained = input.localApp.retainedVersions.length
      ? input.localApp.retainedVersions.map((version) => `v${version}`).join(', ')
      : 'none';
    lines.push(
      '',
      '## Local App Runtime',
      `Extension id: ${sanitizeForPromptLiteral(input.localApp.extensionId)}`,
      `Draft version: v${input.localApp.draftVersion}`,
      `Installed version: ${input.localApp.activeVersion ? `v${input.localApp.activeVersion}` : 'none'}`,
      `Installation: ${input.localApp.installationState} | enabled=${String(input.localApp.enabled)}`,
      `Retained releases: ${retained}`,
      input.localApp.latestAcceptance
        ? `Latest acceptance: ${input.localApp.latestAcceptance.status} | source=${sanitizeForPromptLiteral(input.localApp.latestAcceptance.sourceHash.slice(0, 12))} | checked=${new Date(input.localApp.latestAcceptance.createdAt).toISOString()}`
        : 'Latest acceptance: none',
      ...(input.localApp.latestAcceptance?.failures.map((failure) => (
        `Acceptance failure: ${sanitizeForPromptLiteral(truncateText(failure, 240) ?? '')}`
      )) ?? []),
      'Edit only the Project draft. Do not modify installed release artifacts directly; installation and rollback are host-managed.',
    );
  }

  lines.push('', '## Active Goals');
  if (input.activeGoals.length === 0) {
    lines.push('- None recorded.');
  } else {
    lines.push(...input.activeGoals.map(formatGoal));
  }

  lines.push('', '## Recent Project Sessions');
  if (input.recentSessions.length === 0) {
    lines.push('- None recorded.');
  } else {
    for (const session of input.recentSessions) {
      const label = sanitizeForPromptLiteral(session.name?.trim() || session.key);
      lines.push(`- ${label} | agent=${sanitizeForPromptLiteral(session.agentId)} | updated=${sanitizeForPromptLiteral(session.updatedAt)}`);
    }
  }

  lines.push('', '## Project Memory');
  const memoryRecords = input.memoryRecords ?? [];
  if (memoryRecords.length === 0) {
    lines.push('- None recorded.');
  } else {
    for (const record of memoryRecords) {
      const content = sanitizeForPromptLiteral(truncateText(record.content, 240) ?? '');
      lines.push(`- ${sanitizeForPromptLiteral(record.kind)} | updated=${sanitizeForPromptLiteral(record.updatedAt)} | ${content}`);
    }
  }

  return lines.join('\n');
}

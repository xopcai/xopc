import { GoalService, type GoalWithDetails } from '../../goals/index.js';
import {
  getProjectForSession,
  getProjectWorkspacePathForSession,
} from '../../projects/workspace.js';
import type { Project } from '../../projects/types.js';
import { ProjectStore } from '../../projects/project-store.js';
import { listMemoryRecords } from '../../storage/sqlite/index.js';
import { sanitizeForPromptLiteral } from '../prompt/sanitize-for-prompt.js';

const MAX_TEXT = 1200;
const MAX_GOALS = 5;
const MAX_SESSIONS = 5;
const MAX_MEMORY = 5;

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

export function buildActiveProjectContextForPrompt(sessionKey: string): string | undefined {
  const project = getProjectForSession(sessionKey);
  if (!project) return undefined;
  return formatActiveProjectContextForPrompt({
    project,
    workspacePath: getProjectWorkspacePathForSession(sessionKey) ?? project.workspaceRoot,
    activeGoals: new GoalService().list({
      projectId: project.id,
      status: ['active', 'paused', 'blocked', 'needs_input'],
      limit: MAX_GOALS,
    }),
    recentSessions: new ProjectStore().getRecentSessions(project.id, MAX_SESSIONS),
    memoryRecords: listMemoryRecords({
      projectId: project.id,
      status: 'active',
      limit: MAX_MEMORY,
    }),
  });
}

export function formatActiveProjectContextForPrompt(input: {
  project: Project;
  workspacePath?: string;
  activeGoals: GoalWithDetails[];
  recentSessions: Array<{ key: string; name?: string; updatedAt: string; agentId: string }>;
  memoryRecords?: Array<{ kind: string; content: string; updatedAt: string }>;
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

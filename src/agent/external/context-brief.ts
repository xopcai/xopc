import type { ExternalContextAccess } from '../../agent-config/schema.js';
import { loadConfig } from '../../config/loader.js';
import type { Config } from '../../config/schema.js';
import { ProjectStore } from '../../projects/project-store.js';
import { listCollaborationRules } from '../../storage/sqlite/collaboration-rule-repository.js';
import { resolveUserContextSessionAccess } from '../../user-context/access-policy.js';
import { getUserProfileSnapshot, listUserGoals } from '../../user-model/index.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('ExternalContextBrief');

const MAX_BRIEF_CHARS = 2_400;

function clip(value: string | undefined, max: number): string {
  const cleaned = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.length > max ? `${cleaned.slice(0, max - 1).trimEnd()}…` : cleaned;
}

/**
 * Build a concise, privacy-filtered warm context brief for external runtimes
 * (Codex `developerInstructions`, ACP `systemPrompt`, Claude `--append-system-prompt`).
 * Respects both `execution.contextAccess` and `resolveUserContextSessionAccess`.
 */
export function buildExternalWarmContextBrief(params: {
  conversationId: string;
  projectId?: string;
  contextAccess?: ExternalContextAccess;
  builtInMcpMounted: boolean;
  cfg?: Config;
}): string | undefined {
  const accessTier: ExternalContextAccess = params.contextAccess ?? 'read_only';
  if (accessTier === 'off') return undefined;

  const sections: string[] = [];

  try {
    const cfg = params.cfg ?? loadConfig();
    const userAccess = resolveUserContextSessionAccess(cfg, params.conversationId);
    const matchesProject = (scope: { type: string; id?: string }) =>
      !params.projectId
      || scope.type === 'global'
      || scope.type === 'workspace'
      || (scope.type === 'project' && scope.id === params.projectId);

    if (userAccess.userModel) {
      const userLines: string[] = [];
      const profile = getUserProfileSnapshot();
      const identityBits = [
        profile.callName ? `Preferred name: ${clip(profile.callName, 60)}` : '',
        profile.role ? `Role: ${clip(profile.role, 80)}` : '',
        profile.timezone ? `Timezone: ${clip(profile.timezone, 40)}` : '',
        profile.locale ? `Locale: ${clip(profile.locale, 24)}` : '',
      ].filter(Boolean);
      if (identityBits.length > 0) {
        userLines.push(identityBits.join(' | '));
      }

      const rules = listCollaborationRules()
        .filter((rule) => rule.status === 'active' && matchesProject(rule.scope))
        .sort((a, b) => b.priority - a.priority)
        .slice(0, 6);
      if (rules.length > 0) {
        userLines.push('Collaboration rules:');
        for (const rule of rules) {
          const stmt = clip(rule.statement, 160);
          if (stmt) userLines.push(`- ${stmt}`);
        }
      }

      const goals = listUserGoals()
        .filter((goal) => goal.status === 'active' && matchesProject(goal.scope))
        .slice(0, 3);
      if (goals.length > 0) {
        userLines.push('Active goals:');
        for (const goal of goals) {
          const title = clip(goal.title, 100);
          const outcome = clip(goal.desiredOutcome, 120);
          if (title) userLines.push(`- ${title}${outcome ? `: ${outcome}` : ''}`);
        }
      }

      if (userLines.length > 0) {
        sections.push(`## User Context\n${userLines.join('\n')}`);
      }
    }
  } catch (error) {
    log.debug({ err: error, conversationId: params.conversationId }, 'Skipped user context section in external brief');
  }

  if (params.projectId) {
    try {
      const project = new ProjectStore().get(params.projectId);
      if (project) {
        const projectLines: string[] = [`Project: ${clip(project.name, 120)} (id: ${project.id})`];
        const summary = clip(project.brief || project.description, 360);
        if (summary) projectLines.push(`Summary: ${summary}`);
        const outcome = clip(project.outcome, 200);
        if (outcome) projectLines.push(`Target outcome: ${outcome}`);
        if (project.successCriteria?.length) {
          const items = project.successCriteria.slice(0, 3).map((s) => clip(s, 100)).filter(Boolean);
          if (items.length > 0) projectLines.push(`Success criteria: ${items.join('; ')}`);
        }
        if (project.nonGoals?.length) {
          const items = project.nonGoals.slice(0, 3).map((s) => clip(s, 100)).filter(Boolean);
          if (items.length > 0) projectLines.push(`Non-goals: ${items.join('; ')}`);
        }
        sections.push(`## Active Project\n${projectLines.join('\n')}`);
      }
    } catch (error) {
      log.debug({ err: error, projectId: params.projectId }, 'Skipped project section in external brief');
    }
  }

  if (params.builtInMcpMounted && (accessTier === 'read_only' || accessTier === 'read_write')) {
    const modeLabel = accessTier === 'read_write' ? 'read/write' : 'read-only';
    sections.push(
      `## xopc MCP Tools (${modeLabel})\n`
      + 'The built-in "xopc" MCP server is attached for on-demand lookup when needed: '
      + 'use xopc_user_context_profile and xopc_knowledge_search for user memory/decisions, '
      + 'xopc_sessions_list / xopc_sessions_search / xopc_sessions_read for past conversations, '
      + 'and xopc_notes_* / xopc_tasks_* / xopc_projects_* for workspace notes and tasks.',
    );
  }

  if (sections.length === 0) return undefined;
  const body = sections.join('\n\n');
  const trimmed = body.length > MAX_BRIEF_CHARS ? `${body.slice(0, MAX_BRIEF_CHARS - 1).trimEnd()}…` : body;
  return `<xopc_context>\n${trimmed}\n</xopc_context>`;
}

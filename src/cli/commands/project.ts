import { Command } from 'commander';

import { loadConfig } from '../../config/loader.js';
import {
  isValidProjectAgentId,
  normalizeProjectAgentId,
  ProjectService,
  type Project,
  type ProjectStatus,
} from '../../projects/index.js';
import {
  closeXopcDatabase,
  getSessionMetadata,
  isXopcDatabaseOpen,
  openXopcDatabase,
} from '../../storage/sqlite/index.js';
import { GoalService } from '../../goals/index.js';
import { register, formatExamples, type CLIContext } from '../registry.js';

function parseStatus(raw: string | undefined): ProjectStatus | undefined {
  return raw === 'active' || raw === 'paused' || raw === 'archived' ? raw : undefined;
}

async function withProjects<T>(_ctx: CLIContext, fn: (projects: ProjectService) => Promise<T> | T): Promise<T> {
  const wasOpen = isXopcDatabaseOpen();
  if (!wasOpen) openXopcDatabase();
  try {
    return await fn(new ProjectService());
  } finally {
    if (!wasOpen) closeXopcDatabase();
  }
}

function resolveProject(projects: ProjectService, ref: string): Project | null {
  return projects.get(ref) ?? projects.getBySlug(ref);
}

function formatProject(project: Project & { sessionCount?: number; goalCount?: number; activeGoalCount?: number }): string {
  const counts = [
    project.sessionCount != null ? `sessions ${project.sessionCount}` : undefined,
    project.goalCount != null ? `goals ${project.goalCount}` : undefined,
    project.activeGoalCount != null ? `active goals ${project.activeGoalCount}` : undefined,
  ].filter(Boolean).join(' | ');
  const lines = [
    `${project.id} [${project.status}] ${project.name}`,
    `  Slug: ${project.slug}`,
    project.defaultAgentId ? `  Default agent: ${project.defaultAgentId}` : '  Default agent: global default',
    project.description ? `  Description: ${project.description}` : undefined,
    project.workspaceRoot ? `  Workspace: ${project.workspaceRoot}` : undefined,
    counts ? `  ${counts}` : undefined,
    `  Updated: ${new Date(project.updatedAt).toISOString()}`,
  ];
  return lines.filter(Boolean).join('\n');
}

function createProjectCommand(ctx: CLIContext): Command {
  const cmd = new Command('project')
    .description('Manage long-running projects')
    .addHelpText(
      'after',
      formatExamples([
        'xopc project list',
        'xopc project new xopc --workspace ~/develop/github/xopc',
        'xopc project show xopc',
        'xopc project attach-session <session-key> xopc',
        'xopc project attach-goal <goal-id> xopc',
      ]),
    );

  cmd.addCommand(
    new Command('list')
      .description('List projects')
      .option('--status <status>', 'active, paused, or archived')
      .option('--search <query>', 'Search by name, slug, or description')
      .option('--limit <n>', 'Maximum rows', '20')
      .option('--json', 'Output JSON')
      .action(async (options) => {
        await withProjects(ctx, (projects) => {
          const result = projects.list({
            status: parseStatus(options.status),
            search: options.search,
            limit: Number(options.limit) || 20,
          });
          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
          }
          if (!result.items.length) {
            console.log('No projects.');
            return;
          }
          console.log('Projects:\n');
          for (const project of result.items) {
            console.log(`${formatProject(project)}\n`);
          }
        });
      }),
  );

  cmd.addCommand(
    new Command('new')
      .description('Create a project')
      .argument('<name>', 'Project name')
      .option('--description <text>', 'Project description')
      .option('--default-agent <id>', 'Default agent id for new project sessions and goals')
      .option('--workspace <path>', 'Project workspace root')
      .option('--brief <text>', 'Project brief')
      .option('--instructions <text>', 'Project instructions')
      .option('--json', 'Output JSON')
      .action(async (name, options) => {
        const cfg = loadConfig(ctx.configPath);
        const defaultAgentId = normalizeProjectAgentId(options.defaultAgent);
        if (!isValidProjectAgentId(cfg, defaultAgentId)) {
          console.error(`Agent not found: ${options.defaultAgent}`);
          process.exit(1);
        }
        await withProjects(ctx, (projects) => {
          const project = projects.create({
            name,
            description: options.description,
            defaultAgentId,
            workspaceRoot: options.workspace,
            brief: options.brief,
            instructions: options.instructions,
          });
          if (options.json) {
            console.log(JSON.stringify(project, null, 2));
            return;
          }
          console.log(`Created project ${project.id}`);
          console.log(`  ${project.name} (${project.slug})`);
        });
      }),
  );

  cmd.addCommand(
    new Command('show')
      .description('Show project details')
      .argument('<project>', 'Project id or slug')
      .option('--json', 'Output JSON')
      .action(async (projectRef, options) => {
        await withProjects(ctx, (projects) => {
          const project = resolveProject(projects, projectRef);
          const detailed = project ? projects.getWithDetails(project.id) : null;
          if (!detailed) {
            console.error(`Project not found: ${projectRef}`);
            process.exit(1);
          }
          if (options.json) {
            console.log(JSON.stringify(detailed, null, 2));
            return;
          }
          console.log(formatProject(detailed));
          if (detailed.brief) console.log(`\nBrief:\n${detailed.brief}`);
          if (detailed.instructions) console.log(`\nInstructions:\n${detailed.instructions}`);
        });
      }),
  );

  cmd.addCommand(
    new Command('update')
      .description('Update a project')
      .argument('<project>', 'Project id or slug')
      .option('--name <name>', 'New name')
      .option('--description <text>', 'Project description')
      .option('--default-agent <id>', 'Default agent id for new project sessions and goals')
      .option('--clear-default-agent', 'Clear project default agent')
      .option('--status <status>', 'active, paused, or archived')
      .option('--workspace <path>', 'Project workspace root')
      .option('--brief <text>', 'Project brief')
      .option('--instructions <text>', 'Project instructions')
      .action(async (projectRef, options) => {
        const cfg = loadConfig(ctx.configPath);
        const defaultAgentId = options.clearDefaultAgent ? null : normalizeProjectAgentId(options.defaultAgent);
        if (defaultAgentId && !isValidProjectAgentId(cfg, defaultAgentId)) {
          console.error(`Agent not found: ${options.defaultAgent}`);
          process.exit(1);
        }
        await withProjects(ctx, (projects) => {
          const project = resolveProject(projects, projectRef);
          if (!project) {
            console.error(`Project not found: ${projectRef}`);
            process.exit(1);
          }
          const updated = projects.update(project.id, {
            name: options.name,
            description: options.description,
            ...(options.clearDefaultAgent || options.defaultAgent !== undefined ? { defaultAgentId } : {}),
            status: parseStatus(options.status),
            workspaceRoot: options.workspace,
            brief: options.brief,
            instructions: options.instructions,
          });
          console.log(`Updated project ${updated.id}`);
        });
      }),
  );

  cmd.addCommand(
    new Command('archive')
      .description('Archive a project')
      .argument('<project>', 'Project id or slug')
      .action(async (projectRef) => {
        await withProjects(ctx, (projects) => {
          const project = resolveProject(projects, projectRef);
          if (!project) {
            console.error(`Project not found: ${projectRef}`);
            process.exit(1);
          }
          projects.update(project.id, { status: 'archived' });
          console.log(`Archived project ${project.name}`);
        });
      }),
  );

  cmd.addCommand(
    new Command('attach-session')
      .description('Attach a session to a project')
      .argument('<session-key>', 'Session key')
      .argument('<project>', 'Project id or slug')
      .action(async (sessionKey, projectRef) => {
        await withProjects(ctx, (projects) => {
          const project = resolveProject(projects, projectRef);
          if (!project) {
            console.error(`Project not found: ${projectRef}`);
            process.exit(1);
          }
          projects.attachSession(sessionKey, project.id);
          console.log(`Attached session to ${project.name}`);
        });
      }),
  );

  cmd.addCommand(
    new Command('detach-session')
      .description('Detach a session from its project')
      .argument('<session-key>', 'Session key')
      .action(async (sessionKey) => {
        await withProjects(ctx, (projects) => {
          projects.detachSession(sessionKey);
          console.log('Detached session from project.');
        });
      }),
  );

  cmd.addCommand(
    new Command('attach-goal')
      .description('Attach a goal to a project')
      .argument('<goal-id>', 'Goal id')
      .argument('<project>', 'Project id or slug')
      .action(async (goalId, projectRef) => {
        await withProjects(ctx, (projects) => {
          const project = resolveProject(projects, projectRef);
          if (!project) {
            console.error(`Project not found: ${projectRef}`);
            process.exit(1);
          }
          projects.attachGoal(goalId, project.id);
          console.log(`Attached goal to ${project.name}`);
        });
      }),
  );

  cmd.addCommand(
    new Command('detach-goal')
      .description('Detach a goal from its project')
      .argument('<goal-id>', 'Goal id')
      .action(async (goalId) => {
        await withProjects(ctx, (projects) => {
          projects.detachGoal(goalId);
          console.log('Detached goal from project.');
        });
      }),
  );

  cmd.addCommand(
    new Command('sessions')
      .description('List sessions in a project')
      .argument('<project>', 'Project id or slug')
      .option('--limit <n>', 'Maximum rows', '20')
      .action(async (projectRef, options) => {
        await withProjects(ctx, (projects) => {
          const project = resolveProject(projects, projectRef);
          if (!project) {
            console.error(`Project not found: ${projectRef}`);
            process.exit(1);
          }
          const keys = projects.listSessionKeys(project.id, Number(options.limit) || 20);
          if (!keys.length) {
            console.log('No sessions.');
            return;
          }
          for (const key of keys) {
            const session = getSessionMetadata(key);
            const label = session?.name ? ` - ${session.name}` : '';
            console.log(`${key}${label}`);
          }
        });
      }),
  );

  cmd.addCommand(
    new Command('goals')
      .description('List goals in a project')
      .argument('<project>', 'Project id or slug')
      .option('--limit <n>', 'Maximum rows', '20')
      .action(async (projectRef, options) => {
        await withProjects(ctx, (projects) => {
          const project = resolveProject(projects, projectRef);
          if (!project) {
            console.error(`Project not found: ${projectRef}`);
            process.exit(1);
          }
          const goals = new GoalService().list({ projectId: project.id, limit: Number(options.limit) || 20 });
          if (!goals.length) {
            console.log('No goals.');
            return;
          }
          for (const goal of goals) {
            console.log(`${goal.id} [${goal.status}] ${goal.title}`);
          }
        });
      }),
  );

  return cmd;
}

register({
  id: 'project',
  name: 'project',
  description: 'Manage long-running projects',
  factory: createProjectCommand,
  metadata: {
    category: 'utility',
    examples: ['xopc project list', 'xopc project new xopc', 'xopc project show <project>'],
  },
});

export { createProjectCommand };

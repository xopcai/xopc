import { Command } from 'commander';

import { loadConfig } from '../../config/loader.js';
import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/index.js';
import { GoalService, type GoalEvidence, type GoalWithDetails } from '../../goals/index.js';
import { register, formatExamples, type CLIContext } from '../registry.js';

type EvidenceKind = GoalEvidence['kind'];

function parseEvidenceKind(raw: string | undefined): EvidenceKind {
  if (
    raw === 'file' ||
    raw === 'diff' ||
    raw === 'command' ||
    raw === 'test' ||
    raw === 'link' ||
    raw === 'message' ||
    raw === 'artifact'
  ) {
    return raw;
  }
  return 'message';
}

function summarize(goal: GoalWithDetails): string {
  const done = goal.checklist.filter((it) => it.status === 'completed' || it.status === 'impossible').length;
  const progress = goal.checklist.length ? ` · checklist ${done}/${goal.checklist.length}` : '';
  const next = goal.nextAction ? `\n     Next: ${goal.nextAction}` : '';
  const blocked = goal.blockedReason ? `\n     Blocked: ${goal.blockedReason}` : '';
  return `  ${goal.id} [${goal.status}] ${goal.title}\n     Agent: ${goal.agentId} · turns ${goal.turnsUsed}/${goal.maxTurns}${progress}${next}${blocked}`;
}

async function withGoals<T>(ctx: CLIContext, fn: (goals: GoalService) => Promise<T> | T): Promise<T> {
  openXopcDatabase();
  try {
    return await fn(new GoalService());
  } finally {
    closeXopcDatabase();
  }
}

function printGoal(goal: GoalWithDetails): void {
  console.log(summarize(goal));
  if (goal.checklist.length) {
    console.log('\nChecklist:');
    goal.checklist.forEach((it, index) => {
      const marker = it.status === 'completed' ? '[x]' : it.status === 'impossible' ? '[!]' : '[ ]';
      const evidence = it.evidenceSummary ? ` (${it.evidenceSummary})` : '';
      console.log(`  ${index + 1}. ${marker} ${it.text}${evidence}`);
    });
  }
}

function createGoalCommand(ctx: CLIContext): Command {
  const cmd = new Command('goal')
    .description('Manage durable goals')
    .addHelpText(
      'after',
      formatExamples([
        'xopc goal list',
        'xopc goal new "Ship v0.2 release"',
        'xopc goal show <goal-id>',
        'xopc goal pause <goal-id>',
        'xopc goal resume <goal-id>',
        'xopc goal archive <goal-id>',
        'xopc goal checklist add <goal-id> "Tests pass"',
        'xopc goal evidence add <goal-id> "CI passed" --kind test',
      ]),
    );

  cmd.addCommand(
    new Command('list')
      .description('List goals')
      .option('--status <status>', 'Filter status (comma-separated)')
      .option('--agent-id <id>', 'Filter by agent id')
      .option('--session-key <key>', 'Filter by linked session')
      .option('--limit <n>', 'Maximum rows', '20')
      .action(async (options) => {
        await withGoals(ctx, async (goals) => {
          const rows = goals.list({
            status: options.status?.split(',').map((s: string) => s.trim()).filter(Boolean),
            agentId: options.agentId,
            sessionKey: options.sessionKey,
            limit: Number(options.limit) || 20,
          });
          if (!rows.length) {
            console.log('No goals.');
            return;
          }
          console.log('Goals:\n');
          rows.forEach((goal) => console.log(`${summarize(goal)}\n`));
        });
      }),
  );

  cmd.addCommand(
    new Command('new')
      .description('Create a goal')
      .argument('<title>', 'Goal title')
      .option('--session-key <key>', 'Link to a session key')
      .option('--agent-id <id>', 'Agent id')
      .option('--max-turns <n>', 'Turn budget')
      .option('--priority <level>', 'low, normal, or high', 'normal')
      .action(async (title, options) => {
        const cfg = loadConfig(ctx.configPath);
        await withGoals(ctx, async (goals) => {
          const goal = goals.create({
            title,
            sessionKey: options.sessionKey,
            agentId: options.agentId,
            priority: options.priority === 'low' || options.priority === 'high' ? options.priority : 'normal',
            maxTurns: options.maxTurns ? Number(options.maxTurns) : undefined,
            config: cfg,
            source: 'cli',
          });
          console.log(`Created goal ${goal.id}`);
          console.log(`  ${goal.title}`);
        });
      }),
  );

  cmd.addCommand(
    new Command('show')
      .description('Show a goal')
      .argument('<goal-id>', 'Goal id')
      .action(async (goalId) => {
        await withGoals(ctx, async (goals) => {
          const goal = goals.get(goalId);
          if (!goal) {
            console.error(`Goal not found: ${goalId}`);
            process.exit(1);
          }
          printGoal(goal);
        });
      }),
  );

  for (const [name, description] of [
    ['pause', 'Pause a goal'],
    ['resume', 'Resume a goal'],
    ['archive', 'Archive a goal'],
  ] as const) {
    cmd.addCommand(
      new Command(name)
        .description(description)
        .argument('<goal-id>', 'Goal id')
        .action(async (goalId) => {
          await withGoals(ctx, async (goals) => {
            const goal =
              name === 'pause' ? goals.pause(goalId) : name === 'resume' ? goals.resume(goalId) : goals.archive(goalId);
            if (!goal) {
              console.error(`Goal not found: ${goalId}`);
              process.exit(1);
            }
            console.log(`${description}: ${goal.title}`);
          });
        }),
    );
  }

  cmd.addCommand(
    new Command('runs')
      .description('List goal runs')
      .argument('<goal-id>', 'Goal id')
      .option('--limit <n>', 'Maximum rows', '20')
      .action(async (goalId, options) => {
        await withGoals(ctx, async (goals) => {
          const runs = goals.listRuns(goalId, Number(options.limit) || 20);
          if (!runs.length) {
            console.log('No runs.');
            return;
          }
          runs.forEach((run) => {
            const at = new Date(run.finishedAt ?? run.startedAt).toISOString();
            console.log(`  ${run.id} [${run.verdict ?? run.status}] ${at}`);
            if (run.reason) console.log(`     ${run.reason}`);
          });
        });
      }),
  );

  const checklist = new Command('checklist').description('Manage goal checklist');
  checklist.addCommand(
    new Command('add')
      .argument('<goal-id>', 'Goal id')
      .argument('<text>', 'Checklist item')
      .action(async (goalId, text) => {
        await withGoals(ctx, async (goals) => {
          const goal = goals.updateChecklist(goalId, { type: 'add', text });
          if (!goal) {
            console.error(`Goal not found: ${goalId}`);
            process.exit(1);
          }
          console.log(`Added checklist item to ${goal.title}`);
        });
      }),
  );
  checklist.addCommand(
    new Command('mark')
      .argument('<goal-id>', 'Goal id')
      .argument('<number>', '1-based checklist item number')
      .argument('<status>', 'pending, completed, or impossible')
      .action(async (goalId, number, status) => {
        await withGoals(ctx, async (goals) => {
          const goal = goals.get(goalId);
          const item = goal?.checklist[Number(number) - 1];
          if (!goal || !item) {
            console.error(`Checklist item not found: ${number}`);
            process.exit(1);
          }
          if (status !== 'pending' && status !== 'completed' && status !== 'impossible') {
            console.error('Status must be pending, completed, or impossible');
            process.exit(1);
          }
          goals.updateChecklist(goalId, { type: 'mark', itemId: item.id, status });
          console.log(`Marked item #${number} ${status}`);
        });
      }),
  );
  cmd.addCommand(checklist);

  const evidence = new Command('evidence').description('Manage goal evidence');
  evidence.addCommand(
    new Command('list')
      .argument('<goal-id>', 'Goal id')
      .option('--limit <n>', 'Maximum rows', '20')
      .action(async (goalId, options) => {
        await withGoals(ctx, async (goals) => {
          if (!goals.get(goalId)) {
            console.error(`Goal not found: ${goalId}`);
            process.exit(1);
          }
          const rows = goals.listEvidence(goalId, Number(options.limit) || 20);
          if (!rows.length) {
            console.log('No evidence.');
            return;
          }
          rows.forEach((item) => {
            const at = new Date(item.createdAt).toISOString();
            console.log(`  ${item.id} [${item.kind}] ${item.title} · ${at}`);
            if (item.uri) console.log(`     URI: ${item.uri}`);
            if (item.summary) console.log(`     ${item.summary}`);
          });
        });
      }),
  );
  evidence.addCommand(
    new Command('add')
      .argument('<goal-id>', 'Goal id')
      .argument('<title>', 'Evidence title')
      .option('--kind <kind>', 'file, diff, command, test, link, message, or artifact', 'message')
      .option('--summary <text>', 'Evidence summary')
      .option('--uri <uri>', 'URI or local path')
      .action(async (goalId, title, options) => {
        await withGoals(ctx, async (goals) => {
          if (!goals.get(goalId)) {
            console.error(`Goal not found: ${goalId}`);
            process.exit(1);
          }
          const evidence = goals.addEvidence({
            goalId,
            kind: parseEvidenceKind(options.kind),
            title,
            summary: typeof options.summary === 'string' ? options.summary : undefined,
            uri: typeof options.uri === 'string' ? options.uri : undefined,
          });
          console.log(`Added evidence ${evidence.id}`);
          console.log(`  [${evidence.kind}] ${evidence.title}`);
        });
      }),
  );
  cmd.addCommand(evidence);

  return cmd;
}

register({
  id: 'goal',
  name: 'goal',
  description: 'Manage durable goals',
  factory: createGoalCommand,
  metadata: {
    category: 'utility',
    examples: ['xopc goal list', 'xopc goal new "Ship the release"', 'xopc goal show <goal-id>'],
  },
});

export { createGoalCommand };

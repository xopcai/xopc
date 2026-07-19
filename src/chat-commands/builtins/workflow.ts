/**
 * `/workflows` and `/workflow <subcommand>` — read-only commands for browsing
 * saved workflows.
 *
 * Why only read commands here? Slash command results are sent to the user; they
 * are NOT injected back into the agent's turn. Triggering a workflow run from
 * the slash layer would require a non-trivial cross-cutting "inject this as the
 * next user message" hook that doesn't exist yet. Instead, the workflow tool
 * understands `name`, and its description tells the model to prefer that route
 * whenever a user mentions a saved workflow by name. Plain text — "run the
 * audit_repo workflow" — works end-to-end.
 *
 * `/workflows` and `/workflow view` make discovery cheap, which is the missing
 * piece.
 */

import { commandRegistry } from '../registry.js';
import type { CommandContext, CommandDefinition } from '../types.js';
import { bulletList, code, joinBlocks, section } from '../format-output.js';

import { createWorkflowCatalog } from '../../agent/workflow/catalog.js';
import type { CatalogEntry } from '../../agent/workflow/catalog.js';
import { extractProfileAgentId } from '../../config/agent-profile.js';

function formatEntryDetail(entry: CatalogEntry): string {
  const tags = entry.tags?.length ? `[${entry.tags.join(', ')}] ` : '';
  const agents = entry.estimatedAgents
    ? ` (~${entry.estimatedAgents.min}–${entry.estimatedAgents.max} agents)`
    : '';
  return `${tags}${entry.description}${agents}`;
}

function formatWorkflowListContent(entries: CatalogEntry[]): string {
  const grouped = {
    builtin: entries.filter((e) => e.source === 'builtin'),
    user: entries.filter((e) => e.source === 'user'),
  };
  const exampleName = entries[0]?.name ?? 'audit_repo';
  const blocks: string[] = [];

  if (grouped.user.length > 0) {
    blocks.push(
      joinBlocks(
        section('User workflows'),
        bulletList(grouped.user.map((e) => ({ label: e.name, detail: formatEntryDetail(e) }))),
      ),
    );
  }
  if (grouped.builtin.length > 0) {
    blocks.push(
      joinBlocks(
        section('Built-in workflows'),
        bulletList(grouped.builtin.map((e) => ({ label: e.name, detail: formatEntryDetail(e) }))),
      ),
    );
  }

  blocks.push(
    joinBlocks(
      section('How to run'),
      bulletList([
        `Plain language: "run the ${exampleName} workflow"`,
        `Inspect its visual structure: ${code(`/workflow view ${exampleName}`)}`,
        'Create and edit workflows in the Workflow Studio.',
      ]),
    ),
  );

  return joinBlocks(...blocks);
}

const workflowsCommand: CommandDefinition = {
  id: 'system.workflows',
  name: 'workflows',
  description: 'List saved workflows (built-in + ~/.xopc/workflows/)',
  category: 'system',
  scope: ['global', 'private', 'group'],
  handler: async (_ctx: CommandContext) => {
    const catalog = createWorkflowCatalog();
    const entries = catalog.list();
    if (entries.length === 0) {
      return {
        content: 'No workflows found. Create one in the Workflow Studio.',
        success: true,
      };
    }
    return { content: formatWorkflowListContent(entries), success: true };
  },
};

export const workflowCommand: CommandDefinition = {
  id: 'system.workflow',
  name: 'workflow',
  description: 'Inspect or manage saved workflows. Subcommands: list, view <name>',
  category: 'system',
  scope: ['global', 'private', 'group'],
  acceptsArgs: true,
  examples: ['/workflow list', '/workflow view audit_repo'],
  handler: async (ctx: CommandContext, args: string) => {
    const trimmed = args.trim();
    if (!trimmed || trimmed.toLowerCase() === 'list') {
      return workflowsCommand.handler(ctx, '');
    }
    const [sub, ...rest] = trimmed.split(/\s+/);
    const subLower = sub.toLowerCase();
    const target = rest.join(' ').trim();

    if (subLower === 'view' || subLower === 'show' || subLower === 'cat') {
      if (!target) {
        return { content: `usage: ${code('/workflow view <name>')}`, success: false };
      }
      const catalog = createWorkflowCatalog();
      try {
        const loaded = catalog.load(target);
        const nodeSummary = loaded.graph.nodes.map((node) => `${node.title} (${node.kind})`).join(' → ');
        return {
          content: joinBlocks(
            `**${loaded.title}** (${loaded.metadata.source}) — ${loaded.description}`,
            `Flow: ${nodeSummary}`,
            `Revision: ${loaded.revision}`,
          ),
          success: true,
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: `error: ${message}`, success: false };
      }
    }

    if (subLower === 'run' || subLower === 'start') {
      return runWorkflowFromCommand(ctx, target);
    }

    return {
      content: joinBlocks(
        `Unknown subcommand "${sub}". Available: list, view ${code('<name>')}, run ${code('<name>')}.`,
        `Run directly with ${code('/workflow run <name> [--goal "..."] [--json \'{...}\']')}.`,
      ),
      success: false,
    };
  },
};

async function runWorkflowFromCommand(ctx: CommandContext, args: string) {
  if (!ctx.workflowRunApis) {
    return {
      content: 'Workflow runs are not available in this context.',
      success: false,
    };
  }

  let parsed: { name: string; goal?: string; input?: unknown };
  try {
    parsed = parseWorkflowRunArgs(args);
  } catch (err) {
    return {
      content: `error: ${err instanceof Error ? err.message : String(err)}`,
      success: false,
    };
  }
  if (!parsed.name) {
    return {
      content: `usage: ${code('/workflow run <name> [--goal "..."] [--json \'{...}\']')}`,
      success: false,
    };
  }

  const catalog = createWorkflowCatalog();
  try {
    catalog.load(parsed.name);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { content: `error: ${message}`, success: false };
  }

  const agentId = extractProfileAgentId(ctx.sessionKey, ctx.config);
  const source =
    ctx.source === 'webui' || ctx.channelId === 'webchat'
      ? ({ kind: 'webui' as const, sessionKey: ctx.sessionKey })
      : ({ kind: 'chat' as const, sessionKey: ctx.sessionKey });
  const result = await ctx.workflowRunApis.startWorkflowRun({
    agentId,
    definitionId: parsed.name,
    goal: parsed.goal,
    input: parsed.input,
    parentSessionKey: ctx.sessionKey,
    source,
  });

  if (result.ok === false) {
    return {
      content: `error: ${result.message}`,
      success: false,
      metadata: {
        workflowRun: {
          ok: false,
          definitionId: parsed.name,
          code: result.code,
          message: result.message,
        },
      },
    };
  }

  const content = joinBlocks(
    `Started workflow **${parsed.name}**.`,
    bulletList([
      { label: 'runId', detail: code(result.runId) },
      { label: 'sessionKey', detail: code(result.sessionKey) },
    ]),
  );

  return {
    content,
    success: true,
    metadata: {
      workflowRun: {
        ok: true,
        definitionId: parsed.name,
        runId: result.runId,
        sessionKey: result.sessionKey,
        parentSessionKey: ctx.sessionKey,
      },
    },
  };
}

function parseWorkflowRunArgs(raw: string): { name: string; goal?: string; input?: unknown } {
  const tokens = tokenizeArgs(raw);
  const name = tokens.shift()?.trim() ?? '';
  let goal: string | undefined;
  let input: unknown;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '--goal' || token === '-g') {
      goal = tokens[++i]?.trim() || undefined;
      continue;
    }
    if (token.startsWith('--goal=')) {
      goal = token.slice('--goal='.length).trim() || undefined;
      continue;
    }
    if (token === '--json' || token === '--input') {
      const value = tokens[++i];
      input = parseJsonArg(value, token);
      continue;
    }
    if (token.startsWith('--json=')) {
      input = parseJsonArg(token.slice('--json='.length), '--json');
      continue;
    }
    if (token.startsWith('--input=')) {
      input = parseJsonArg(token.slice('--input='.length), '--input');
      continue;
    }
    if (!goal) {
      goal = [token, ...tokens.slice(i + 1)].join(' ').trim() || undefined;
      break;
    }
  }

  return { name, goal, input };
}

function parseJsonArg(value: string | undefined, flag: string): unknown {
  if (!value?.trim()) {
    throw new Error(`${flag} requires a JSON value`);
  }
  try {
    return JSON.parse(value);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${flag} is not valid JSON: ${message}`);
  }
}

function tokenizeArgs(raw: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    tokens.push(value.replace(/\\(["'\\])/g, '$1'));
  }
  return tokens;
}

export function registerWorkflowCommands(): void {
  commandRegistry.register(workflowsCommand);
  commandRegistry.register(workflowCommand);
}

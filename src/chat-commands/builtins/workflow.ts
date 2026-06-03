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

import { createWorkflowCatalog } from '../../agent/workflow/catalog.js';
import { getLastWorkflowMemory } from '../../agent/workflow/last-run-memory.js';

const VIEW_MAX_LINES = 200;

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
        content: `No workflows found. Drop a script at ${catalog.userDir}/<name>.js to add one.`,
        success: true,
      };
    }
    const grouped = {
      builtin: entries.filter((e) => e.source === 'builtin'),
      user: entries.filter((e) => e.source === 'user'),
    };
    const lines: string[] = [];
    if (grouped.user.length > 0) {
      lines.push('*User workflows*');
      for (const e of grouped.user) {
        lines.push(`• ${e.name} — ${e.description}`);
      }
      lines.push('');
    }
    if (grouped.builtin.length > 0) {
      lines.push('*Built-in workflows*');
      for (const e of grouped.builtin) {
        lines.push(`• ${e.name} — ${e.description}`);
      }
      lines.push('');
    }
    lines.push('How to run:');
    lines.push(`  • Plain language: "run the ${entries[0].name} workflow"`);
    lines.push(`  • Inspect source: /workflow view ${entries[0].name}`);
    lines.push(`  • Add your own:  drop a .js at ${catalog.userDir}`);
    return { content: lines.join('\n').trimEnd(), success: true };
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
        return { content: 'usage: /workflow view <name>', success: false };
      }
      const catalog = createWorkflowCatalog();
      try {
        const loaded = catalog.load(target);
        const lines = loaded.script.split('\n');
        const visible =
          lines.length > VIEW_MAX_LINES
            ? [...lines.slice(0, VIEW_MAX_LINES), `… (truncated; ${lines.length - VIEW_MAX_LINES} more lines)`]
            : lines;
        const source = loaded.source === 'user' ? loaded.path ?? 'user' : 'built-in';
        return {
          content: `*${loaded.name}* (${source}) — ${loaded.meta.description}\n\n\`\`\`js\n${visible.join('\n')}\n\`\`\``,
          success: true,
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: `error: ${message}`, success: false };
      }
    }

    if (subLower === 'run' || subLower === 'start') {
      return {
        content:
          `To run a workflow, ask in plain language: "run the ${target || '<name>'} workflow".\n` +
          'The assistant will call the workflow tool with name="' +
          (target || '<name>') +
          '" and stream progress inline.',
        success: true,
      };
    }

    if (subLower === 'save') {
      if (!target) {
        return { content: 'usage: /workflow save <name>', success: false };
      }
      const last = getLastWorkflowMemory().get(ctx.sessionKey);
      if (!last) {
        return {
          content:
            'No workflow has run successfully in this session yet. Run one first (e.g. ask "run the audit_repo workflow"), then /workflow save <name>.',
          success: false,
        };
      }
      const catalog = createWorkflowCatalog();
      try {
        // Allow the user to rename: if target differs from meta.name, rewrite it
        // before saving so the file is addressable as `target`.
        const script =
          last.metaName === target ? last.script : rewriteMetaName(last.script, target);
        const { path } = catalog.save(target, script);
        return {
          content:
            `✓ Saved workflow "${target}" → ${path}\n` +
            `Trigger it any time with /${target}, "run the ${target} workflow", or via /workflow view ${target} to inspect.`,
          success: true,
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { content: `error: ${message}`, success: false };
      }
    }

    return {
      content:
        `Unknown subcommand "${sub}". Available: list, view <name>, save <name>.\n` +
        'To run a workflow, ask in plain language ("run the audit_repo workflow") — the assistant uses the workflow tool with name="...".',
      success: false,
    };
  },
};

/**
 * Replace the `name` field inside the FIRST `export const meta = { ... }` literal.
 *
 * Why text-level (not AST re-emit)? The parser already accepted the script
 * once (the runtime ran it), so the surrounding code is unchanged. A targeted
 * regex on the `name: '...'` slot inside the first object literal keeps the
 * user's formatting / comments / quote style intact, which an AST round-trip
 * would smash. The match anchors to the first `name:` after `export const meta`
 * and only touches that single value.
 */
function rewriteMetaName(script: string, newName: string): string {
  const re = /(export\s+const\s+meta\s*=\s*\{[^}]*?\bname\s*:\s*)(['"`])([^'"`]*)\2/;
  if (!re.test(script)) {
    throw new Error('could not locate meta.name in the recorded script to rewrite');
  }
  return script.replace(re, (_m, prefix, quote) => `${prefix}${quote}${newName}${quote}`);
}

export function registerWorkflowCommands(): void {
  commandRegistry.register(workflowsCommand);
  commandRegistry.register(workflowCommand);
}

import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';

import { resolveToCwd } from '../../utils/helpers.js';
import { evaluateFilePolicy } from '../sandbox/exec-policy.js';
import { isSearchFileAllowed, repositorySearch } from './repository-search.js';

const grepSchema = Type.Object({
  pattern: Type.String({ description: 'Ripgrep regex, or literal text when literal=true' }),
  path: Type.Optional(Type.String()), glob: Type.Optional(Type.String()),
  ignoreCase: Type.Optional(Type.Boolean()), literal: Type.Optional(Type.Boolean()),
  context: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
});
export interface GrepToolDetails { truncated: boolean }
export type GrepToolInput = Static<typeof grepSchema>;

export function createGrepTool(cwd: string): AgentTool {
  return {
    name: 'grep', label: 'Search', parameters: grepSchema,
    description: 'Search with ripgrep, respecting .gitignore and skipping binary files. Returns path:line content. Use a narrow path or glob; output is bounded.',
    supportsParallel: true, idempotent: true,
    async execute(_id, params: GrepToolInput, signal) {
      let path = resolveToCwd(params.path || '.', cwd);
      const policy = evaluateFilePolicy({ operation: 'read', path, workspaceRoot: cwd });
      if (!policy.allowed) throw new Error(policy.reason);
      path = policy.canonicalPath!;
      const limit = Math.min(1000, Math.max(1, params.limit ?? 100));
      const result = await repositorySearch(cwd, [
        '--json', '--line-number', '--with-filename', '--color', 'never', '--max-columns', '300', '--max-columns-preview',
        '--max-count', String(limit), '--context', String(params.context ?? 0),
        ...(params.ignoreCase ? ['--ignore-case'] : []), ...(params.literal ? ['--fixed-strings'] : []),
        ...(params.glob ? ['--glob', params.glob] : []), '-e', params.pattern, '--', path,
      ], signal);
      const lines: string[] = [];
      for (const row of result.output.split('\n')) {
        if (!row) continue;
        let event: { type: string; data?: { path?: { text?: string }; lines?: { text?: string }; line_number?: number } };
        try { event = JSON.parse(row); }
        catch { if (result.truncated) continue; throw new Error('Invalid search output'); }
        if (event.type !== 'match' && event.type !== 'context') continue;
        const data = event.data;
        if (!data?.path?.text || !data.lines?.text || !isSearchFileAllowed(cwd, data.path.text)) continue;
        const separator = event.type === 'match' ? ':' : '-';
        lines.push(`${data.path.text}${separator}${data.line_number}${separator}${data.lines.text.replace(/\r?\n$/, '')}`);
      }
      const outputLimit = limit * (1 + 2 * (params.context ?? 0));
      const truncated = result.truncated || lines.length > outputLimit;
      return { content: [{ type: 'text', text: (lines.length ? lines.slice(0, outputLimit).join('\n') : 'No matches found')
        + (truncated ? '\n[Results truncated; narrow the path or pattern.]' : '') }], details: { truncated } };
    },
  } as AgentTool;
}
export const grepTool = createGrepTool(process.cwd());

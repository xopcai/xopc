import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';

import { resolveToCwd } from '../../utils/helpers.js';
import { evaluateFilePolicy } from '../sandbox/exec-policy.js';
import { repositorySearch } from './repository-search.js';

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
      const path = resolveToCwd(params.path || '.', cwd);
      const policy = evaluateFilePolicy({ operation: 'read', path, workspaceRoot: cwd });
      if (!policy.allowed) throw new Error(policy.reason);
      const limit = Math.min(1000, Math.max(1, params.limit ?? 100));
      const result = await repositorySearch(cwd, [
        '--line-number', '--with-filename', '--color', 'never', '--max-columns', '300', '--max-columns-preview',
        '--max-count', String(limit), '--context', String(params.context ?? 0),
        ...(params.ignoreCase ? ['--ignore-case'] : []), ...(params.literal ? ['--fixed-strings'] : []),
        ...(params.glob ? ['--glob', params.glob] : []), '-e', params.pattern, '--', path,
      ], signal);
      const lines = result.output.trimEnd().split('\n');
      const outputLimit = limit * (1 + 2 * (params.context ?? 0));
      const truncated = result.truncated || lines.length > outputLimit;
      return { content: [{ type: 'text', text: (result.output ? lines.slice(0, outputLimit).join('\n') : 'No matches found')
        + (truncated ? '\n[Results truncated; narrow the path or pattern.]' : '') }], details: { truncated } };
    },
  } as AgentTool;
}
export const grepTool = createGrepTool(process.cwd());

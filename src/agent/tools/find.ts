import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';

import { resolveToCwd } from '../../utils/helpers.js';
import { evaluateFilePolicy } from '../sandbox/exec-policy.js';
import { repositorySearch } from './repository-search.js';

const findSchema = Type.Object({
  pattern: Type.String({ description: 'Glob pattern, e.g. *.ts or src/**/*.json' }),
  path: Type.Optional(Type.String()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })),
});
export interface FindToolDetails { truncated: boolean }
export type FindToolInput = Static<typeof findSchema>;
export function createFindTool(cwd: string): AgentTool {
  return {
    name: 'find', label: 'Find files', parameters: findSchema,
    description: 'Find files by glob with ripgrep; respects .gitignore and skips .git and node_modules. Results are relative to the search directory.',
    supportsParallel: true, idempotent: true,
    async execute(_id, params: FindToolInput, signal) {
      const path = resolveToCwd(params.path || '.', cwd);
      const policy = evaluateFilePolicy({ operation: 'read', path, workspaceRoot: cwd });
      if (!policy.allowed) throw new Error(policy.reason);
      const result = await repositorySearch(path, ['--files', '--glob', params.pattern], signal);
      const limit = Math.min(10000, Math.max(1, params.limit ?? 1000));
      const lines = result.output.trimEnd().split('\n').filter(Boolean).sort();
      const truncated = result.truncated || lines.length > limit;
      return { content: [{ type: 'text', text: (lines.slice(0, limit).join('\n') || 'No files found matching pattern')
        + (truncated ? '\n[Results truncated; narrow the glob.]' : '') }], details: { truncated } };
    },
  } as AgentTool;
}
export const findTool = createFindTool(process.cwd());

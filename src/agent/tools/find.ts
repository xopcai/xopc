import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { existsSync } from 'fs';
import { globSync } from 'glob';
import path from 'path';
import { DEFAULT_MAX_BYTES, formatSize, type TruncationResult, truncateHead } from './truncate.js';
import { resolveToCwd } from './path-utils.js';

const findSchema = Type.Object({
	pattern: Type.String({
		description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'",
	}),
	path: Type.Optional(Type.String({ description: 'Directory to search in (default: current directory)' })),
	limit: Type.Optional(Type.Number({ description: 'Maximum number of results (default: 1000)' })),
});

export type FindToolInput = Static<typeof findSchema>;

const DEFAULT_LIMIT = 1000;

export interface FindToolDetails {
	truncation?: TruncationResult;
	resultLimitReached?: number;
}

/**
 * Find tool - Search for files by glob pattern
 */
export function createFindTool(cwd: string): AgentTool<typeof findSchema> {
	return {
		name: 'find',
		label: '📁 find',
		description: `Search for files by glob pattern. Returns matching file paths relative to the search directory. Output is truncated to ${DEFAULT_LIMIT} results or ${DEFAULT_MAX_BYTES / 1024}KB.`,
		parameters: findSchema,
		execute: async (
			_toolCallId: string,
			params: Static<typeof findSchema>,
			signal?: AbortSignal
		): Promise<AgentToolResult<FindToolDetails>> => {
			try {
				const searchPath = resolveToCwd(params.path || '.', cwd);
				const effectiveLimit = params.limit || DEFAULT_LIMIT;

				if (!existsSync(searchPath)) {
					return {
						content: [{ type: 'text', text: `Error: Path not found: ${searchPath}` }],
						details: {},
					};
				}

				if (signal?.aborted) {
					return {
						content: [{ type: 'text', text: 'Operation aborted' }],
						details: {},
					};
				}

				const filePaths = globSync(params.pattern, {
					cwd: searchPath,
					dot: true,
					ignore: ['**/node_modules/**', '**/.git/**'],
				});

				if (filePaths.length === 0) {
					return {
						content: [{ type: 'text', text: 'No files found matching pattern' }],
						details: {},
					};
				}

				// Relativize paths
				const relativized = filePaths.map((p) => {
					if (p.startsWith(searchPath)) {
						return p.slice(searchPath.length + 1);
					}
					return path.relative(searchPath, p);
				});

				// Sort results
				relativized.sort();

				const resultLimitReached = relativized.length >= effectiveLimit;
				const outputLines = resultLimitReached ? relativized.slice(0, effectiveLimit) : relativized;
				const rawOutput = outputLines.join('\n');
				const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });

				let resultOutput = truncation.content;
				const details: FindToolDetails = {};
				const notices: string[] = [];

				if (resultLimitReached) {
					notices.push(`${effectiveLimit} results limit reached`);
					details.resultLimitReached = effectiveLimit;
				}

				if (truncation.truncated) {
					notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
					details.truncation = truncation;
				}

				if (notices.length > 0) {
					resultOutput += `\n\n[${notices.join('. ')}]`;
				}

				return {
					content: [{ type: 'text', text: resultOutput }],
					details: Object.keys(details).length > 0 ? details : undefined,
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text',
							text: `Error during find: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					details: {},
				};
			}
		},
	};
}

/** Default find tool using process.cwd() */
export const findTool = createFindTool(process.cwd());

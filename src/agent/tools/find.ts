import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { existsSync } from 'fs';
import { globSync } from 'glob';
import path from 'path';
import { DEFAULT_MAX_BYTES, formatSize, type TruncationResult, truncateHead } from './truncate.js';
import { resolveToCwd } from '../../utils/helpers.js';

const findSchema = Type.Object({
	pattern: Type.String({
		description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'",
	}),
	path: Type.Optional(Type.String({ description: 'Directory to search in (default: current directory)' })),
	limit: Type.Optional(Type.Number({ description: 'Maximum number of results (default: 1000)' })),
});

export type FindToolInput = { pattern: string; path?: string; limit?: number };

const DEFAULT_LIMIT = 1000;

export interface FindToolDetails {
	truncation?: TruncationResult;
	resultLimitReached?: number;
}

/**
 * Find tool - Search for files by glob pattern
 */
export function createFindTool(cwd: string): AgentTool {
	return {
		name: 'find',
		label: '📁 find',
		description: 'Find files by glob pattern (e.g., *.ts, **/*.json).',
		parameters: findSchema,
		execute: async (
			_toolCallId: string,
			params: any,
			signal?: AbortSignal
		): Promise<AgentToolResult<FindToolDetails>> => {
			try {
				const p = params as FindToolInput;
				const searchPath = resolveToCwd(p.path || '.', cwd);
				const effectiveLimit = p.limit || DEFAULT_LIMIT;

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

				const filePaths = globSync(p.pattern, {
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
	} as any;
}

/** Default find tool using process.cwd() */
export const findTool: AgentTool = createFindTool(process.cwd());

import { Type, type Static } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { readFileSync, existsSync, statSync } from 'fs';
import { globSync } from 'glob';
import path from 'path';
import {
	DEFAULT_MAX_BYTES,
	formatSize,
	GREP_MAX_LINE_LENGTH,
	type TruncationResult,
	truncateHead,
	truncateLine,
} from './truncate.js';
import { resolveToCwd } from './path-utils.js';

const grepSchema = Type.Object({
	pattern: Type.String({ description: 'Search pattern (regex or literal string)' }),
	path: Type.Optional(Type.String({ description: 'Directory or file to search (default: current directory)' })),
	glob: Type.Optional(Type.String({ description: "Filter files by glob pattern, e.g. '*.ts'" })),
	ignoreCase: Type.Optional(Type.Boolean({ description: 'Case-insensitive search (default: false)' })),
	literal: Type.Optional(Type.Boolean({ description: 'Treat pattern as literal string instead of regex (default: false)' })),
	context: Type.Optional(Type.Number({ description: 'Number of lines to show before and after each match (default: 0)' })),
	limit: Type.Optional(Type.Number({ description: 'Maximum number of matches to return (default: 100)' })),
});

export type GrepToolInput = Static<typeof grepSchema>;

const DEFAULT_LIMIT = 100;

export interface GrepToolDetails {
	truncation?: TruncationResult;
	matchLimitReached?: number;
	linesTruncated?: boolean;
}

/**
 * Simple grep implementation using Node.js regex
 */
function simpleGrep(
	content: string,
	pattern: string,
	options: { ignoreCase: boolean; literal: boolean }
): Array<{ lineNumber: number; line: string }> {
	const matches: Array<{ lineNumber: number; line: string }> = [];
	const lines = content.split('\n');
	const regexPattern = options.literal
		? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
		: pattern;
	const flags = options.ignoreCase ? 'i' : '';
	const regex = new RegExp(regexPattern, flags);

	for (let i = 0; i < lines.length; i++) {
		if (regex.test(lines[i])) {
			matches.push({ lineNumber: i + 1, line: lines[i] });
		}
	}

	return matches;
}

/**
 * Grep tool - Search file contents for a pattern
 */
export function createGrepTool(cwd: string): AgentTool<typeof grepSchema> {
	return {
		name: 'grep',
		label: '🔍 grep',
		description: 'Search file contents for a pattern (regex or literal).',
		parameters: grepSchema,
		execute: async (
			_toolCallId: string,
			params: Static<typeof grepSchema>,
			signal?: AbortSignal
		): Promise<AgentToolResult<GrepToolDetails>> => {
			try {
				const searchPath = resolveToCwd(params.path || '.', cwd);
				
				if (!existsSync(searchPath)) {
					return {
						content: [{ type: 'text', text: `Error: Path not found: ${searchPath}` }],
						details: {},
					};
				}

				const isDirectory = statSync(searchPath).isDirectory();
				const context = params.context || 0;
				const effectiveLimit = params.limit || DEFAULT_LIMIT;
				const files: string[] = [];

				// Collect files to search
				if (isDirectory) {
					const globPattern = params.glob || '**/*';
					const filePaths = globSync(globPattern, {
						cwd: searchPath,
						dot: true,
						ignore: ['**/node_modules/**', '**/.git/**'],
					});
					files.push(...filePaths.map(f => path.join(searchPath, f)));
				} else {
					files.push(searchPath);
				}

				const matches: Array<{ file: string; lineNumber: number; line: string }> = [];
				let matchCount = 0;
				let linesTruncated = false;

				// Search each file
				for (const filePath of files) {
					if (signal?.aborted) {
						return {
							content: [{ type: 'text', text: 'Operation aborted' }],
							details: {},
						};
					}

					try {
						if (!existsSync(filePath)) continue;
						const content = readFileSync(filePath, 'utf-8');
						const fileMatches = simpleGrep(content, params.pattern, {
							ignoreCase: params.ignoreCase || false,
							literal: params.literal || false,
						});

						for (const match of fileMatches) {
							if (matchCount >= effectiveLimit) break;
							matches.push({ file: filePath, ...match });
							matchCount++;
						}
					} catch {
						// Skip files that can't be read
					}

					if (matchCount >= effectiveLimit) break;
				}

				if (matches.length === 0) {
					return {
						content: [{ type: 'text', text: 'No matches found' }],
						details: {},
					};
				}

				// Format output
				const outputLines: string[] = [];
				const basePath = isDirectory ? searchPath : path.dirname(searchPath);

				for (const match of matches) {
					const relativePath = path.relative(basePath, match.file);
					const { text: truncatedLine, wasTruncated } = truncateLine(match.line);
					if (wasTruncated) linesTruncated = true;

					if (context > 0) {
						// Add context lines
						try {
							const content = readFileSync(match.file, 'utf-8');
							const allLines = content.split('\n');
							const start = Math.max(1, match.lineNumber - context);
							const end = Math.min(allLines.length, match.lineNumber + context);

							for (let i = start; i <= end; i++) {
								const lineText = allLines[i - 1] || '';
								const { text: truncatedContextLine } = truncateLine(lineText);
								if (i === match.lineNumber) {
									outputLines.push(`${relativePath}:${i}: ${truncatedContextLine}`);
								} else {
									outputLines.push(`${relativePath}-${i}- ${truncatedContextLine}`);
								}
							}
						} catch {
							outputLines.push(`${relativePath}:${match.lineNumber}: ${truncatedLine}`);
						}
					} else {
						outputLines.push(`${relativePath}:${match.lineNumber}: ${truncatedLine}`);
					}
				}

				const rawOutput = outputLines.join('\n');
				const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });

				let output = truncation.content;
				const details: GrepToolDetails = {};
				const notices: string[] = [];

				if (matches.length >= effectiveLimit) {
					notices.push(`${effectiveLimit} matches limit reached`);
					details.matchLimitReached = effectiveLimit;
				}

				if (truncation.truncated) {
					notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
					details.truncation = truncation;
				}

				if (linesTruncated) {
					notices.push(`Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars`);
					details.linesTruncated = true;
				}

				if (notices.length > 0) {
					output += `\n\n[${notices.join('. ')}]`;
				}

				return {
					content: [{ type: 'text', text: output }],
					details: Object.keys(details).length > 0 ? details : undefined,
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text',
							text: `Error during grep: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					details: {},
				};
			}
		},
	};
}

/** Default grep tool using process.cwd() */
export const grepTool = createGrepTool(process.cwd());

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import type {
  CodeIntelligenceRuntimeLike,
  CodeIntelligenceStatus,
  CodeIntelligenceToolResult,
} from './types.js';

export interface CodeIntelligenceToolDeps {
  getRuntime: () => CodeIntelligenceRuntimeLike;
}

type ToolDetails = { codeIntelligence: CodeIntelligenceStatus };
const execFileAsync = promisify(execFile);

function statusHeader(status: CodeIntelligenceStatus): string {
  const fields = [
    `project=${status.project}`,
    `freshness=${status.state}`,
    `coverage=${status.coverage}`,
  ];
  if (status.indexedAt) fields.push(`indexedAt=${status.indexedAt}`);
  if (status.dirtyPaths.length > 0) fields.push(`dirtyPaths=${status.dirtyPaths.length}`);
  return `[Code intelligence: ${fields.join(', ')}]`;
}

function success(result: CodeIntelligenceToolResult): AgentToolResult<ToolDetails> {
  return {
    content: [{ type: 'text', text: `${statusHeader(result.status)}\n${result.text}`.trim() }],
    details: { codeIntelligence: result.status },
  };
}

function failure(error: unknown, runtime: CodeIntelligenceRuntimeLike): AgentToolResult<ToolDetails> {
  const status = runtime.getStatus();
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{
      type: 'text',
      text: `${statusHeader(status)}\nCode intelligence failed: ${message}\nUse grep/find/read_file for direct source inspection and do not infer absence from the graph.`,
    }],
    details: { codeIntelligence: status },
  };
}

function searchWasEmpty(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as { total?: unknown };
    return parsed.total === 0;
  } catch {
    return /(?:^|\n)total:\s*0(?:\n|$)/.test(text);
  }
}

function escapeCypherString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function normalizeDetectChangesResult(
  result: CodeIntelligenceToolResult,
  limit: number,
): CodeIntelligenceToolResult {
  try {
    const parsed = JSON.parse(result.text) as Record<string, unknown>;
    if (!Array.isArray(parsed.changed_files)) return result;
    const changedFiles = [...new Set(parsed.changed_files.filter(
      (file): file is string => typeof file === 'string',
    ))];
    const impactedSymbols = Array.isArray(parsed.impacted_symbols)
      ? parsed.impacted_symbols
      : [];
    const impactedSymbolCount = impactedSymbols.length;
    return {
      ...result,
      text: JSON.stringify({
        ...parsed,
        changed_files: changedFiles,
        changed_count: changedFiles.length,
        impacted_symbols: impactedSymbols.slice(0, limit),
        impacted_symbol_count: impactedSymbolCount,
        impacted_symbols_truncated: impactedSymbolCount > limit,
      }),
    };
  } catch {
    return result;
  }
}

async function changedFilesForImpact(params: {
  workspace: string;
  since?: string;
  baseBranch?: string;
  scope?: string;
}): Promise<string[]> {
  const args = ['diff', '--name-only'];
  if (params.baseBranch) {
    args.push(`${params.baseBranch}...HEAD`);
  } else {
    args.push(params.since ?? 'HEAD');
  }
  args.push('--');
  if (params.scope) args.push(params.scope);
  const untrackedArgs = ['ls-files', '--others', '--exclude-standard', '--'];
  if (params.scope) untrackedArgs.push(params.scope);
  const [diff, untracked] = await Promise.all([
    execFileAsync('git', args, {
      cwd: params.workspace,
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    }),
    execFileAsync('git', untrackedArgs, {
      cwd: params.workspace,
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    }),
  ]);
  return [...new Set(`${diff.stdout}\n${untracked.stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean))].slice(0, 100);
}

async function queryImpactCompatibility(
  runtime: CodeIntelligenceRuntimeLike,
  params: { since?: string; baseBranch?: string; scope?: string; depth?: number; limit?: number },
  signal?: AbortSignal,
): Promise<CodeIntelligenceToolResult> {
  const status = runtime.getStatus();
  const files = await changedFilesForImpact({
    workspace: status.workspace,
    since: params.since,
    baseBranch: params.baseBranch,
    scope: params.scope,
  });
  if (files.length === 0) {
    return { text: 'No changed files found for the requested Git comparison.', status };
  }
  const predicate = files
    .map((file) => `changed.file_path = '${escapeCypherString(file)}'`)
    .join(' OR ');
  const depth = Math.max(1, Math.min(5, Math.floor(params.depth ?? 3)));
  const limit = Math.max(1, Math.min(500, Math.floor(params.limit ?? 100)));
  const query = [
    'MATCH (changed)',
    `WHERE ${predicate}`,
    `OPTIONAL MATCH (caller)-[:CALLS*1..${depth}]->(changed)`,
    'RETURN DISTINCT changed.qualified_name AS changed_symbol, changed.file_path AS changed_file,',
    'caller.qualified_name AS affected_caller, caller.file_path AS affected_file',
    `LIMIT ${limit}`,
  ].join(' ');
  const result = await runtime.callTool('query_graph', {
    project: status.project,
    query,
    max_rows: limit,
  }, signal);
  return {
    ...result,
    text: `Changed files (${files.length}):\n${files.join('\n')}\n\nGraph impact:\n${result.text}`,
  };
}

function buildTool<T extends Record<string, unknown>>(options: {
  name: string;
  description: string;
  parameters: ReturnType<typeof Type.Object>;
  run: (runtime: CodeIntelligenceRuntimeLike, params: T, signal?: AbortSignal) => Promise<CodeIntelligenceToolResult>;
  deps: CodeIntelligenceToolDeps;
}): AgentTool {
  return {
    name: options.name,
    label: options.name,
    description: options.description,
    parameters: options.parameters,
    supportsParallel: true,
    idempotent: true,
    async execute(_toolCallId, params, signal) {
      const runtime = options.deps.getRuntime();
      try {
        return success(await options.run(runtime, params as T, signal));
      } catch (error) {
        return failure(error, runtime);
      }
    },
  } as AgentTool;
}

const SearchSchema = Type.Object({
  query: Type.String({ description: 'Natural-language intent or symbol keywords' }),
  label: Type.Optional(Type.String({ description: 'Optional graph label such as Function, Method, Class, Interface, or Route' })),
  filePattern: Type.Optional(Type.String({ description: 'Optional file/path pattern to narrow the search' })),
  semanticKeywords: Type.Optional(Type.Array(Type.String(), { description: 'Optional semantic concepts; use 2-4 concise terms' })),
  limit: Type.Optional(Type.Number({ description: 'Maximum results, default 20' })),
});

const ReadSymbolSchema = Type.Object({
  qualifiedName: Type.String({ description: 'Exact qualified_name returned by code_search' }),
  includeNeighbors: Type.Optional(Type.Boolean({ description: 'Include nearby source context' })),
});

const TraceSchema = Type.Object({
  functionName: Type.String({ description: 'Exact or unambiguous function/method name' }),
  direction: Type.Optional(Type.Union([
    Type.Literal('inbound'),
    Type.Literal('outbound'),
    Type.Literal('both'),
  ])),
  depth: Type.Optional(Type.Number({ description: 'Traversal depth, default 3' })),
  mode: Type.Optional(Type.Union([
    Type.Literal('calls'),
    Type.Literal('data_flow'),
    Type.Literal('cross_service'),
  ])),
  parameterName: Type.Optional(Type.String({ description: 'Parameter to follow in data_flow mode' })),
  includeTests: Type.Optional(Type.Boolean()),
  riskLabels: Type.Optional(Type.Boolean()),
});

const ImpactSchema = Type.Object({
  since: Type.Optional(Type.String({ description: 'Git ref or date, for example HEAD~1 or a tag' })),
  baseBranch: Type.Optional(Type.String({ description: 'Base branch for comparison' })),
  scope: Type.Optional(Type.String({ description: 'Optional file or directory scope' })),
  depth: Type.Optional(Type.Number({ description: 'Impact traversal depth, default 3' })),
  limit: Type.Optional(Type.Number({ description: 'Maximum impacted symbols, default 100, maximum 500' })),
});

const ArchitectureSchema = Type.Object({
  aspects: Type.Optional(Type.Array(Type.String(), {
    description: 'Optional aspects such as packages, boundaries, layers, entry_points, hotspots, or clusters',
  })),
});

export function createCodeIntelligenceTools(deps: CodeIntelligenceToolDeps): AgentTool[] {
  return [
    buildTool({
      name: 'code_search',
      description: 'Search the repository knowledge graph for definitions, implementations, routes, types, and structurally important symbols. Prefer this over grep for code discovery.',
      parameters: SearchSchema,
      deps,
      run: async (runtime, params: {
        query: string;
        label?: string;
        filePattern?: string;
        semanticKeywords?: string[];
        limit?: number;
      }, signal) => {
        const graphResult = await runtime.callTool('search_graph', {
          project: runtime.getStatus().project,
          query: params.query,
          ...(params.label ? { label: params.label } : {}),
          ...(params.filePattern ? { file_pattern: params.filePattern } : {}),
          ...(params.semanticKeywords?.length ? { semantic_query: params.semanticKeywords } : {}),
          limit: params.limit ?? 20,
        }, signal);
        if (!searchWasEmpty(graphResult.text)) return graphResult;
        const textResult = await runtime.callTool('search_code', {
          project: runtime.getStatus().project,
          pattern: params.query,
          ...(params.filePattern ? { path_filter: params.filePattern } : {}),
          mode: 'compact',
          limit: params.limit ?? 20,
        }, signal);
        return {
          ...textResult,
          text: `No graph symbol matched; graph-augmented text fallback:\n${textResult.text}`,
        };
      },
    }),
    buildTool({
      name: 'code_read_symbol',
      description: 'Read the exact source for a symbol returned by code_search. Use this to ground graph results in current source before editing.',
      parameters: ReadSymbolSchema,
      deps,
      run: (runtime, params: { qualifiedName: string; includeNeighbors?: boolean }, signal) =>
        runtime.callTool('get_code_snippet', {
          project: runtime.getStatus().project,
          qualified_name: params.qualifiedName,
          include_neighbors: params.includeNeighbors ?? false,
        }, signal),
    }),
    buildTool({
      name: 'code_trace',
      description: 'Trace callers, callees, data flow, or cross-service paths for a function or method.',
      parameters: TraceSchema,
      deps,
      run: (runtime, params: {
        functionName: string;
        direction?: 'inbound' | 'outbound' | 'both';
        depth?: number;
        mode?: 'calls' | 'data_flow' | 'cross_service';
        parameterName?: string;
        includeTests?: boolean;
        riskLabels?: boolean;
      }, signal) => runtime.callTool(['trace_path', 'trace_call_path'], {
        project: runtime.getStatus().project,
        function_name: params.functionName,
        direction: params.direction ?? 'both',
        depth: params.depth ?? 3,
        mode: params.mode ?? 'calls',
        ...(params.parameterName ? { parameter_name: params.parameterName } : {}),
        include_tests: params.includeTests ?? false,
        risk_labels: params.riskLabels ?? false,
      }, signal),
    }),
    buildTool({
      name: 'code_impact',
      description: 'Map the current git diff or a git range to changed symbols, callers, and blast radius before or after edits.',
      parameters: ImpactSchema,
      deps,
      run: async (runtime, params: { since?: string; baseBranch?: string; scope?: string; depth?: number; limit?: number }, signal) => {
        const limit = Math.max(1, Math.min(500, Math.floor(params.limit ?? 100)));
        if (runtime.supportsTool('detect_changes')) {
          const result = await runtime.callTool('detect_changes', {
            project: runtime.getStatus().project,
            ...(params.since || !params.baseBranch ? { since: params.since ?? 'HEAD' } : {}),
            ...(params.baseBranch ? { base_branch: params.baseBranch } : {}),
            ...(params.scope ? { scope: params.scope } : {}),
            depth: params.depth ?? 3,
          }, signal);
          return normalizeDetectChangesResult(result, limit);
        }
        return queryImpactCompatibility(runtime, params, signal);
      },
    }),
    buildTool({
      name: 'code_architecture',
      description: 'Get a compact repository architecture map including packages, boundaries, layers, entry points, hotspots, and graph-derived clusters.',
      parameters: ArchitectureSchema,
      deps,
      run: (runtime, params: { aspects?: string[] }, signal) => runtime.callTool('get_architecture', {
        project: runtime.getStatus().project,
        ...(params.aspects?.length ? { aspects: params.aspects } : {}),
      }, signal),
    }),
  ];
}

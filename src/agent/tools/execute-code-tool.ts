/**
 * Programmatic tool calling (PTC): run sandboxed JS that invokes a subset of agent tools.
 * vm is not a strong security boundary; only trusted models should use this tool.
 */

import { Script, createContext } from 'node:vm';

import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

/** Default script wall time when `timeout` omitted (30 minutes). */
const DEFAULT_TIMEOUT_SEC = 30 * 60;
/** Hard cap for `timeout` parameter (4 hours). */
const MAX_TIMEOUT_SEC = 4 * 60 * 60;

const ExecuteCodeSchema = Type.Object({
  code: Type.String({
    description:
      'JavaScript to run. Exposed as `tools` (async functions) and `console`:\n' +
      '  await tools.web_search(query, count?)\n' +
      '  await tools.web_fetch(url, maxChars?)\n' +
      '  await tools.read_file(path, limit?)\n' +
      '  await tools.write_file(path, content)\n' +
      '  await tools.grep(pattern, { path?, glob?, ignoreCase?, literal?, context?, limit? })\n' +
      '  await tools.find(pattern, { path?, limit? })\n' +
      '  await tools.shell(command)\n\n' +
      'Use console.log() for output; combined stdout/stderr is returned.',
  }),
  timeout: Type.Optional(
    Type.Number({
      description: 'Execution timeout in seconds (default: 1800 = 30m, max: 14400 = 4h)',
      default: DEFAULT_TIMEOUT_SEC,
    }),
  ),
});

export const SANDBOX_ALLOWED_TOOLS = new Set([
  'web_search',
  'web_fetch',
  'read_file',
  'write_file',
  'grep',
  'find',
  'shell',
  'skills_list',
  'skill_view',
]);

const MAX_TIMEOUT_MS = MAX_TIMEOUT_SEC * 1000;
const MAX_TOOL_CALLS = 50;
const MAX_STDOUT_CHARS = 50_000;
const MAX_STDERR_CHARS = 10_000;

function stringifyArg(a: unknown): string {
  if (typeof a === 'string') {
    return a;
  }
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

function extractTextFromResult(result: AgentToolResult<unknown>): string {
  return result.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('');
}

export function buildSandboxToolMap(tools: AgentTool<any, any>[]): Map<string, AgentTool<any, any>> {
  const m = new Map<string, AgentTool<any, any>>();
  for (const t of tools) {
    if (SANDBOX_ALLOWED_TOOLS.has(t.name)) {
      m.set(t.name, t);
    }
  }
  return m;
}

function createToolsApi(
  getMap: () => Map<string, AgentTool<any, any>>,
  signal: AbortSignal | undefined,
): Record<string, (...args: unknown[]) => Promise<string>> {
  let seq = 0;
  let calls = 0;

  const bump = (): void => {
    calls += 1;
    if (calls > MAX_TOOL_CALLS) {
      throw new Error(`Exceeded max sandbox tool calls (${MAX_TOOL_CALLS})`);
    }
  };

  const run = async (name: string, params: Record<string, unknown>): Promise<string> => {
    if (signal?.aborted) {
      throw new Error('aborted');
    }
    bump();
    const tool = getMap().get(name);
    if (!tool) {
      throw new Error(`Tool not available in sandbox: ${name}`);
    }
    const id = `ptc-${Date.now()}-${seq++}`;
    const result = await (tool as any).execute(id, params, signal);
    return extractTextFromResult(result);
  };

  return {
    web_search: async (query: unknown, count?: unknown) =>
      run('web_search', {
        query: String(query ?? ''),
        ...(typeof count === 'number' && Number.isFinite(count) ? { count } : {}),
      }),

    web_fetch: async (url: unknown, maxChars?: unknown) =>
      run('web_fetch', {
        url: String(url ?? ''),
        ...(typeof maxChars === 'number' && Number.isFinite(maxChars) ? { maxChars } : {}),
      }),

    read_file: async (path: unknown, limit?: unknown) =>
      run('read_file', {
        path: String(path ?? ''),
        ...(typeof limit === 'number' && Number.isFinite(limit) ? { limit } : {}),
      }),

    write_file: async (path: unknown, content: unknown) =>
      run('write_file', {
        path: String(path ?? ''),
        content: String(content ?? ''),
      }),

    grep: async (pattern: unknown, opts?: unknown) => {
      const o = opts && typeof opts === 'object' && opts !== null ? (opts as Record<string, unknown>) : {};
      return run('grep', {
        pattern: String(pattern ?? ''),
        ...(typeof o.path === 'string' ? { path: o.path } : {}),
        ...(typeof o.glob === 'string' ? { glob: o.glob } : {}),
        ...(typeof o.ignoreCase === 'boolean' ? { ignoreCase: o.ignoreCase } : {}),
        ...(typeof o.literal === 'boolean' ? { literal: o.literal } : {}),
        ...(typeof o.context === 'number' && Number.isFinite(o.context) ? { context: o.context } : {}),
        ...(typeof o.limit === 'number' && Number.isFinite(o.limit) ? { limit: o.limit } : {}),
      });
    },

    find: async (pattern: unknown, opts?: unknown) => {
      const o = opts && typeof opts === 'object' && opts !== null ? (opts as Record<string, unknown>) : {};
      return run('find', {
        pattern: String(pattern ?? ''),
        ...(typeof o.path === 'string' ? { path: o.path } : {}),
        ...(typeof o.limit === 'number' && Number.isFinite(o.limit) ? { limit: o.limit } : {}),
      });
    },

    shell: async (command: unknown) => run('shell', { command: String(command ?? '') }),
  };
}

async function runSandboxedScript(
  code: string,
  sandbox: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const context = createContext(sandbox, { name: 'execute_code' });
  const wrapped = `(async () => {\n${code}\n})()`;
  const script = new Script(wrapped, { filename: 'execute_code.vm' });
  const runPromise = script.runInContext(context) as Promise<unknown>;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, rej) => {
    timeoutId = setTimeout(
      () => rej(new Error(`Script timed out after ${Math.round(timeoutMs / 1000)}s`)),
      timeoutMs,
    );
  });

  const abortPromise =
    signal &&
    new Promise<never>((_, rej) => {
      if (signal.aborted) {
        rej(new Error('aborted'));
        return;
      }
      signal.addEventListener('abort', () => rej(new Error('aborted')), { once: true });
    });

  const racers: Promise<unknown>[] = [runPromise, timeoutPromise];
  if (abortPromise) {
    racers.push(abortPromise);
  }

  try {
    await Promise.race(racers);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export interface ExecuteCodeToolDeps {
  getSandboxToolMap: () => Map<string, AgentTool<any, any>>;
}

type ExecuteCodeParams = { code: string; timeout?: number };

export function createExecuteCodeTool(deps: ExecuteCodeToolDeps): AgentTool {
  return {
    name: 'execute_code',
    label: '⚡ Execute Code',
    description:
      'Run sandboxed JavaScript that calls a subset of tools via `tools.*` (batch work in one step).\n\n' +
      'Only stdout/stderr from `console` plus tool return text (as strings) are visible — not full tool JSON.\n\n' +
      'WHEN TO USE: loops over files/URLs, simple branching between tool calls.\n' +
      'WHEN NOT TO USE: single tool calls; tasks needing full tool schemas or disallowed tools.\n\n' +
      'API: `await tools.web_search(q, count?)`, `web_fetch(url, maxChars?)`, `read_file(path, limit?)`, ' +
      '`write_file(path, content)`, `grep(pattern, opts?)`, `find(glob, opts?)`, `shell(command)`. ' +
      'Use `console.log` for output.',
    parameters: ExecuteCodeSchema,

    async execute(
      _toolCallId: string,
      params: any,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<{ exitCode: number }>> {
      const p = params as ExecuteCodeParams;
      const sec = p.timeout ?? DEFAULT_TIMEOUT_SEC;
      const timeoutMs = Math.min(
        Math.max(1, Number.isFinite(sec) ? sec : DEFAULT_TIMEOUT_SEC) * 1000,
        MAX_TIMEOUT_MS,
      );

      const stdout: string[] = [];
      const stderr: string[] = [];

      const toolsApi = createToolsApi(deps.getSandboxToolMap, signal);

      const sandbox: Record<string, unknown> = {
        tools: toolsApi,
        Promise,
        JSON,
        Math,
        Date,
        Array,
        Object,
        String,
        Number,
        Boolean,
        RegExp,
        Map,
        Set,
        Error,
        TypeError,
        RangeError,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        console: {
          log: (...args: unknown[]) => {
            stdout.push(args.map(stringifyArg).join(' '));
          },
          error: (...args: unknown[]) => {
            stderr.push(args.map(stringifyArg).join(' '));
          },
          warn: (...args: unknown[]) => {
            stderr.push(args.map(stringifyArg).join(' '));
          },
        },
        setTimeout,
        clearTimeout,
      };

      try {
        await runSandboxedScript(p.code, sandbox, timeoutMs, signal);

        let out = stdout.join('\n');
        if (out.length > MAX_STDOUT_CHARS) {
          out = `${out.slice(0, MAX_STDOUT_CHARS)}\n...(truncated)`;
        }

        const parts: string[] = [];
        if (out.length > 0) {
          parts.push(out);
        }
        if (stderr.length > 0) {
          let err = stderr.join('\n');
          if (err.length > MAX_STDERR_CHARS) {
            err = `${err.slice(0, MAX_STDERR_CHARS)}\n...(truncated)`;
          }
          parts.push(`\nSTDERR:\n${err}`);
        }

        return {
          content: [{ type: 'text', text: parts.join('') || '(no output)' }],
          details: { exitCode: 0 },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Execution failed: ${message}` }],
          details: { exitCode: 1 },
        };
      }
    },
  } as any;
}

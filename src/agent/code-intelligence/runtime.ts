import { mkdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { Config } from '../../config/schema.js';
import { resolveStateDir } from '../../config/paths.js';
import { createLogger } from '../../utils/logger.js';
import { XopcStdioClientTransport } from '../mcp/mcp-stdio-transport.js';
import { resolveCodebaseMemoryBinary } from './binary.js';
import type {
  CodeIntelligenceRuntimeLike,
  CodeIntelligenceState,
  CodeIntelligenceStatus,
  CodeIntelligenceToolResult,
} from './types.js';

const log = createLogger('CodeIntelligence');

type JsonRecord = Record<string, unknown>;

function deriveProjectName(workspace: string): string {
  return workspace
    .replace(/^[\\/]+/, '')
    .replace(/[\\/:]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function timeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  return new Promise<T>((resolvePromise, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function resultText(result: CallToolResult): string {
  const parts: string[] = [];
  for (const item of result.content ?? []) {
    if (item.type === 'text' && typeof item.text === 'string') {
      parts.push(item.text);
    }
  }
  return parts.join('\n').trim();
}

function parseJsonRecord(text: string): JsonRecord | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as JsonRecord
      : undefined;
  } catch {
    return undefined;
  }
}

function abortError(): Error {
  return new DOMException('Code intelligence operation aborted', 'AbortError');
}

export class CodeIntelligenceRuntime implements CodeIntelligenceRuntimeLike {
  private readonly workspace: string;
  private readonly project: string;
  private readonly getConfig: () => Config;
  private state: CodeIntelligenceState = 'idle';
  private coverage: CodeIntelligenceStatus['coverage'] = 'unknown';
  private indexedAt: string | undefined;
  private errorMessage: string | undefined;
  private dirtyPaths = new Set<string>();
  private dirtyVersion = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private connectionPromise: Promise<void> | undefined;
  private indexPromise: Promise<void> | undefined;
  private client: Client | undefined;
  private transport: XopcStdioClientTransport | undefined;
  private availableTools = new Set<string>();
  private disposed = false;

  constructor(options: { workspace: string; getConfig: () => Config }) {
    this.workspace = resolve(options.workspace);
    this.project = deriveProjectName(this.workspace);
    this.getConfig = options.getConfig;
  }

  getStatus(): CodeIntelligenceStatus {
    return {
      state: this.state,
      workspace: this.workspace,
      project: this.project,
      indexedAt: this.indexedAt,
      dirtyPaths: [...this.dirtyPaths].toSorted(),
      coverage: this.coverage,
      errorMessage: this.errorMessage,
    };
  }

  supportsTool(name: string): boolean {
    return this.availableTools.has(name);
  }

  async prime(): Promise<void> {
    const config = this.getConfig().codeIntelligence;
    if (!config.enabled || !config.autoIndex || this.disposed) return;
    if (this.indexPromise) return this.indexPromise;
    if (this.indexedAt && this.dirtyPaths.size === 0) return;
    await this.refreshIndex();
  }

  markDirty(paths: readonly string[]): void {
    const config = this.getConfig().codeIntelligence;
    if (!config.enabled || !config.autoRefresh || this.disposed) return;

    let changed = false;
    for (const input of paths) {
      if (!input?.trim()) continue;
      const absolute = isAbsolute(input) ? resolve(input) : resolve(this.workspace, input);
      const rel = relative(this.workspace, absolute);
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) continue;
      this.dirtyPaths.add(rel.split(sep).join('/'));
      changed = true;
    }
    if (!changed) return;

    this.dirtyVersion += 1;
    if (this.state === 'ready' || this.state === 'degraded') {
      this.state = 'dirty';
    }
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refreshIndex().catch(() => {});
    }, config.refreshDebounceMs);
    this.refreshTimer.unref?.();
  }

  async callTool(
    toolNames: string | readonly string[],
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CodeIntelligenceToolResult> {
    if (signal?.aborted) throw abortError();
    const config = this.getConfig().codeIntelligence;
    if (!config.enabled) {
      throw new Error('Code intelligence is disabled');
    }

    if (
      config.autoIndex &&
      (this.indexedAt === undefined || this.state === 'idle' || this.dirtyPaths.size > 0)
    ) {
      await this.refreshIndex();
    } else {
      await this.ensureConnected();
    }
    if (signal?.aborted) throw abortError();

    const names = typeof toolNames === 'string' ? [toolNames] : [...toolNames];
    const toolName = names.find((name) => this.availableTools.has(name));
    if (!toolName) {
      throw new Error(`CBM does not expose a supported tool: ${names.join(' or ')}`);
    }
    const result = await this.callRaw(toolName, input, config.queryTimeoutMs);
    const text = resultText(result);
    if (result.isError) {
      throw new Error(text || `CBM ${toolName} failed`);
    }
    return { text, status: this.getStatus() };
  }

  private async ensureConnected(): Promise<void> {
    if (this.disposed) throw new Error('Code intelligence runtime is disposed');
    if (this.client && this.transport) return;
    if (this.connectionPromise) return this.connectionPromise;

    this.connectionPromise = (async () => {
      this.state = 'connecting';
      const config = this.getConfig().codeIntelligence;
      const binary = resolveCodebaseMemoryBinary(config.binaryPath);
      const cacheDir = join(resolveStateDir(), 'code-intelligence', 'cbm');
      mkdirSync(cacheDir, { recursive: true });
      const transport = new XopcStdioClientTransport({
        command: binary,
        cwd: this.workspace,
        env: {
          CBM_ALLOWED_ROOT: this.workspace,
          CBM_CACHE_DIR: cacheDir,
          CBM_LOG_LEVEL: process.env.XOPC_LOG_LEVEL === 'debug' ? 'debug' : 'warn',
        },
        stderr: 'pipe',
      });
      const client = new Client({ name: 'xopc-code-intelligence', version: '1.0.0' });
      transport.stderr?.on('data', (chunk: Buffer | string) => {
        for (const line of String(chunk).split(/\r?\n/)) {
          if (line.trim()) log.debug({ workspace: this.workspace }, `CBM: ${line.trim()}`);
        }
      });

      try {
        await timeout(client.connect(transport), 30_000, 'CBM connection');
        const toolNames = new Set<string>();
        let cursor: string | undefined;
        do {
          const page = await timeout(
            client.listTools(cursor ? { cursor } : undefined),
            20_000,
            'CBM tool discovery',
          );
          for (const tool of page.tools) toolNames.add(tool.name);
          cursor = page.nextCursor;
        } while (cursor);
        this.client = client;
        this.transport = transport;
        this.availableTools = toolNames;
        this.state = this.dirtyPaths.size > 0 ? 'dirty' : 'idle';
        this.errorMessage = undefined;
        log.info(
          { workspace: this.workspace, project: this.project, toolCount: this.availableTools.size },
          'Code intelligence runtime connected',
        );
      } catch (error) {
        await transport.close().catch(() => {});
        await client.close().catch(() => {});
        throw error;
      }
    })();

    try {
      await this.connectionPromise;
    } catch (error) {
      this.state = 'unavailable';
      this.errorMessage = error instanceof Error ? error.message : String(error);
      log.warn(
        { err: error, workspace: this.workspace, project: this.project },
        `Code intelligence unavailable: ${this.errorMessage}`,
      );
      throw error;
    } finally {
      this.connectionPromise = undefined;
    }
  }

  private async refreshIndex(): Promise<void> {
    if (this.disposed) throw new Error('Code intelligence runtime is disposed');
    if (this.indexPromise) return this.indexPromise;

    const versionAtStart = this.dirtyVersion;
    this.indexPromise = (async () => {
      await this.ensureConnected();
      const config = this.getConfig().codeIntelligence;
      this.state = 'indexing';
      const result = await this.callRaw(
        'index_repository',
        {
          repo_path: this.workspace,
          name: this.project,
          mode: config.indexMode,
          persistence: false,
        },
        config.indexTimeoutMs,
      );
      const text = resultText(result);
      const parsed = parseJsonRecord(text);
      const resultStatus = typeof parsed?.status === 'string' ? parsed.status : 'indexed';
      if (result.isError || resultStatus === 'error') {
        throw new Error(text || 'CBM indexing failed');
      }

      this.indexedAt = new Date().toISOString();
      this.coverage = resultStatus === 'degraded' ? 'partial' : 'unknown';
      this.errorMessage = undefined;
      if (versionAtStart === this.dirtyVersion) {
        this.dirtyPaths.clear();
        this.state = resultStatus === 'degraded' ? 'degraded' : 'ready';
      } else {
        this.state = 'dirty';
      }
      log.info(
        {
          workspace: this.workspace,
          project: this.project,
          indexMode: config.indexMode,
          status: resultStatus,
          dirtyPaths: this.dirtyPaths.size,
        },
        'Code intelligence index refreshed',
      );
    })();

    try {
      await this.indexPromise;
    } catch (error) {
      this.state = 'degraded';
      this.coverage = 'unknown';
      this.errorMessage = error instanceof Error ? error.message : String(error);
      log.warn(
        { err: error, workspace: this.workspace, project: this.project },
        `Code intelligence indexing failed: ${this.errorMessage}`,
      );
      throw error;
    } finally {
      this.indexPromise = undefined;
      if (!this.disposed && this.dirtyPaths.size > 0 && versionAtStart !== this.dirtyVersion) {
        queueMicrotask(() => void this.refreshIndex().catch(() => {}));
      }
    }
  }

  private async callRaw(
    toolName: string,
    input: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<CallToolResult> {
    await this.ensureConnected();
    if (!this.client) throw new Error('CBM client is not connected');
    if (!this.availableTools.has(toolName)) {
      throw new Error(`CBM tool is unavailable: ${toolName}`);
    }
    try {
      return await timeout(
        this.client.callTool({ name: toolName, arguments: input }) as Promise<CallToolResult>,
        timeoutMs,
        `CBM ${toolName}`,
      );
    } catch (error) {
      this.state = 'unavailable';
      this.errorMessage = error instanceof Error ? error.message : String(error);
      await this.resetConnection();
      throw error;
    }
  }

  private async resetConnection(): Promise<void> {
    const transport = this.transport;
    const client = this.client;
    this.transport = undefined;
    this.client = undefined;
    this.availableTools.clear();
    await client?.close().catch(() => {});
    await transport?.close().catch(() => {});
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.state = 'disposed';
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    await this.resetConnection();
  }
}

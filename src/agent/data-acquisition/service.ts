import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AgentTool } from '@earendil-works/pi-agent-core';

import { checkedFilePath, readWorkspaceFileAsync } from '../sandbox/fileAccess.js';
import { checkFileSafety } from '../prompt/safety.js';
import { parseRepositoryMatch, repositorySearch } from '../tools/repository-search.js';
import { dataScheduler } from './scheduler.js';
import { DATA_OPERATION_TOOLS, nativeDataArgs, validateDataBatch, type DataBatchArgs, type DataOperation } from './schema.js';
import { readGitData } from './git.js';
import { executeWithTimeout } from '../lifecycle/timeout-wrapper.js';
import type { DataBatchResult, DataFragment, DataOperationResult } from './types.js';

/** Each batch owns its read cache; permissions are checked before sharing any data. */
export interface DataSourceOptions {
  getTools?: () => readonly AgentTool[];
  allowHostGit?: () => boolean;
  canExecute?: (toolName: string) => boolean;
}

export async function acquireData(workspace: string, args: DataBatchArgs, allowed: ReadonlySet<string>, signal?: AbortSignal, options: DataSourceOptions = {}): Promise<DataBatchResult> {
  validateDataBatch(args);
  signal?.throwIfAborted();
  const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15_000)]);
  const files = new Map<string, Promise<{ lines: string[]; revision: string }>>();
  const result: DataBatchResult = { schemaVersion: 1, operations: [], fragments: [], sourceRequests: 0 };
  let readBytes = 0;
  const runOperation = async (op: DataOperation) => {
    const started = Date.now();
    const output: DataOperationResult = { id: op.id, kind: op.kind, status: 'ok', fragmentIds: [], scope: '', sourceExhausted: false, outputOmitted: false, durationMs: 0 };
    const fragments: DataFragment[] = [];
    const add = (resource: string, text: string, startLine: number, revision?: string) => {
      fragments.push({ id: '', operationIds: [op.id], source: { kind: 'file', resource, revision, capturedAt: new Date().toISOString() },
        startLine, endLine: startLine + text.split('\n').length - 1, text });
    };
    try {
      deadline.throwIfAborted();
      const toolAllowed = () => allowed.has(DATA_OPERATION_TOOLS[op.kind]) && options.canExecute?.(DATA_OPERATION_TOOLS[op.kind]) !== false;
      if (!toolAllowed()) {
        output.status = 'denied'; output.reason = 'Underlying tool is not allowed';
        return { output, fragments };
      }
      const checkPermission = () => {
        if (!toolAllowed() || (op.kind === 'git_read' && options.canExecute?.('read_file') === false)) throw new Error('Sandbox: data access was revoked');
      };
      if (op.kind === 'git_read' && !allowed.has('read_file')) {
        output.status = 'denied'; output.reason = 'Git object reads require read_file permission'; return { output, fragments };
      }
      const operationSignal = AbortSignal.any([deadline, AbortSignal.timeout(5_000)]);
      const safePath = (input: string) => {
        const safety = checkFileSafety('read', input);
        if (!safety.allowed) throw new Error(`Sandbox: ${safety.message}`);
        return checkedFilePath(workspace, resolve(workspace, input), 'read');
      };
      if (op.kind === 'file_read') {
        const target = safePath(op.path);
        const first = op.startLine ?? 1;
        const count = op.maxLines ?? 120;
        output.scope = `${target}:${first}-${first + count - 1}`;
        let reading = files.get(target);
        if (!reading) {
          reading = dataScheduler.run(workspace, operationSignal, async () => {
            checkPermission();
            const bytes = (await stat(target)).size;
            if (readBytes + bytes > 32 * 1024 * 1024) throw new Error('Batch read byte budget exceeded');
            readBytes += bytes;
            result.sourceRequests++;
            const data = await readWorkspaceFileAsync(workspace, target, operationSignal, Math.min(bytes, 10 * 1024 * 1024));
            if (data.includes(0)) throw new Error('Binary file: use the appropriate media or document tool');
            return { lines: data.toString('utf8').split('\n'), revision: createHash('sha256').update(data).digest('hex') };
          });
          files.set(target, reading);
        }
        const { lines, revision } = await reading;
        operationSignal.throwIfAborted();
        if (first > lines.length) throw new Error(`Offset ${first} exceeds ${lines.length} lines`);
        const requestedEnd = Math.min(lines.length, first - 1 + count);
        let end = first - 1, bytes = 0;
        while (end < requestedEnd) {
          const size = Buffer.byteLength(lines[end]!) + 1;
          if (bytes + size > Math.floor(256 * 1024 / args.operations.length)) break;
          bytes += size; end++;
        }
        if (end === first - 1) throw new Error('Line exceeds batch fragment budget; use a targeted search or a format-specific tool');
        output.outputOmitted = end < requestedEnd;
        add(target, lines.slice(first - 1, end).join('\n'), first, revision);
        output.scope = `${target}:${first}-${end}`;
        output.sourceExhausted = end === lines.length;
        if (!output.sourceExhausted) output.next = { path: target, startLine: end + 1, maxLines: count };
      } else if (op.kind === 'file_search') {
        const paths = op.paths.map(safePath);
        output.scope = JSON.stringify({ paths, patterns: op.patterns, glob: op.glob }).slice(0, 3000);
        const byFile = new Map<string, DataFragment[]>();
        let buffered = 0;
        result.sourceRequests++;
        const search = await repositorySearch(workspace, [
          '--json', '--line-number', '--with-filename', '--color', 'never', '--context', String(op.contextLines ?? 2),
          ...(op.literal ? ['--fixed-strings'] : []), ...(op.ignoreCase ? ['--ignore-case'] : []),
          ...(op.glob ? ['--glob', op.glob] : []), ...op.patterns.flatMap(pattern => ['-e', pattern]), '--', ...paths,
        ], operationSignal, { maxBytes: Math.min(1024 * 1024, Math.floor(4 * 1024 * 1024 / args.operations.length)), onLine: line => {
          const match = parseRepositoryMatch(workspace, line);
          if (!match) return;
          const resource = match.path;
          const text = match.text;
          const bytes = Buffer.byteLength(text);
          if (bytes > 4096 || buffered + bytes > Math.floor(256 * 1024 / args.operations.length)) {
            output.outputOmitted = true; return;
          }
          const group = byFile.get(resource) ?? [];
          const last = group.at(-1);
          if (last && last.endLine === match.line - 1 && Buffer.byteLength(last.text) + bytes < 4096) {
            last.text += `\n${text}`; last.endLine = match.line;
          } else if (group.length < 3 && fragments.length < 32) {
            add(resource, text, match.line);
            group.push(fragments.at(-1)!); byFile.set(resource, group);
          } else { output.outputOmitted = true; return; }
          buffered += bytes;
        } });
        output.sourceExhausted = !search.truncated;
        if (search.truncated) { output.status = 'partial'; output.reason = 'scan_budget'; }
      } else if (op.kind === 'git_read' || op.kind === 'git_recent') {
        if (options.allowHostGit?.() === false) throw new Error('Sandbox: use exec_command for Git in the configured isolated environment');
        const git = await readGitData(workspace, op, operationSignal, () => { result.sourceRequests++; });
        output.scope = JSON.stringify(op);
        output.sourceExhausted = git.exhausted;
        if (git.reason) { output.status = 'partial'; output.reason = git.reason; output.outputOmitted = git.reason === 'output_budget'; }
        fragments.push({ id: '', operationIds: [op.id], source: { kind: 'git', resource: git.resource, revision: git.revision, capturedAt: new Date().toISOString() }, text: git.text });
      } else {
        const tool = options.getTools?.().find(tool => tool.name === DATA_OPERATION_TOOLS[op.kind]);
        if (!tool) throw new Error('Data source tool is unavailable');
        const resource = op.kind === 'web_fetch' ? op.url : op.kind === 'knowledge_get' ? op.knowledgeId
          : op.kind === 'external_read' ? `${op.toolRef}#account=${encodeURIComponent(String(op.arguments.xopcAccountId ?? ''))}` : op.query;
        output.scope = JSON.stringify({ kind: op.kind, resource });
        const resourceKey = op.kind === 'external_read' ? `connector:${op.toolRef.split(':').slice(0, 2).join(':')}:${String(op.arguments.xopcAccountId ?? '')}`
          : op.kind.startsWith('web_') ? `web:${op.kind === 'web_fetch' ? new URL(op.url).hostname : 'search'}` : workspace;
        const native = await executeWithTimeout(() => dataScheduler.run(resourceKey, operationSignal, async () => {
          checkPermission();
          result.sourceRequests++;
          return tool.execute(op.id, nativeDataArgs(op), operationSignal);
        }), { toolName: op.kind, signal: operationSignal, timeoutMs: 15_000 });
        operationSignal.throwIfAborted();
        const details = native.details as Record<string, unknown> | undefined;
        if (details?.error || details?.status === 'failed') throw new Error(String(details.error ?? 'Data source failed'));
        const text = native.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
        if (text.length > 32_000) { output.outputOmitted = true; }
        if (details?.truncated) { output.outputOmitted = true; }
        fragments.push({ id: '', operationIds: [op.id], source: { kind: op.kind, resource,
          revision: op.kind === 'external_read' ? op.revision : undefined, capturedAt: new Date().toISOString() }, text: text.slice(0, 32_000) });
        output.sourceExhausted = details?.complete === true;
      }
      checkPermission();
      if (output.outputOmitted) { output.status = 'partial'; output.reason ??= 'output_budget'; }
    } catch (error) {
      output.status = deadline.aborted ? 'cancelled' : String(error).includes('Sandbox:') ? 'denied' : 'error';
      output.reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      if (fragments.length && output.status === 'error') output.status = 'partial';
      if (output.status === 'denied' || output.status === 'cancelled') fragments.length = 0;
    } finally { output.durationMs = Date.now() - started; }
    return { output, fragments };
  };
  const operations: Awaited<ReturnType<typeof runOperation>>[] = new Array(args.operations.length);
  let nextOperation = 0;
  await Promise.all(Array.from({ length: Math.min(4, args.operations.length) }, async () => {
    while (nextOperation < args.operations.length) {
      const index = nextOperation++;
      operations[index] = await runOperation(args.operations[index]!);
    }
  }));
  const unique = new Map<string, DataFragment>();
  for (const { output, fragments } of operations) {
    for (const fragment of fragments) {
      const key = JSON.stringify([fragment.source.kind, fragment.source.resource, fragment.source.revision, fragment.startLine, fragment.text]);
      const previous = unique.get(key);
      if (previous) { previous.operationIds.push(output.id); output.fragmentIds.push(previous.id); }
      else {
        fragment.id = `f${unique.size + 1}`;
        unique.set(key, fragment); output.fragmentIds.push(fragment.id); result.fragments.push(fragment);
      }
    }
    result.operations.push(output);
  }
  return result;
}

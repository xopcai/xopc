import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { realpath, stat } from 'node:fs/promises';
import { relative, isAbsolute, sep } from 'node:path';

import { checkedFilePath, readWorkspaceFile, writeWorkspaceFile, deleteWorkspaceFile } from '../sandbox/fileAccess.js';
import { detectLineEnding, generateDiffString, normalizeToLF, restoreLineEndings } from './edit-diff.js';

const ApplyPatchSchema = Type.Object({
  patch: Type.String({
    description: [
      'Patch text using the grammar:',
      '*** Begin Patch',
      '*** Add File: path / *** Delete File: path / *** Update File: path',
      'optional *** Move to: path for update hunks',
      '@@ then lines prefixed with space, -, or +',
      '*** End Patch',
    ].join(' '),
  }),
});

export type AppliedPatchChangeKind = 'add' | 'delete' | 'update' | 'move';

export interface AppliedPatchChange {
  kind: AppliedPatchChangeKind;
  path: string;
  absolutePath: string;
  moveTo?: string;
  absoluteMoveTo?: string;
  added: number;
  removed: number;
  diff: string;
}

export interface ApplyPatchDetails {
  changes: AppliedPatchChange[];
  files: string[];
  summary: string;
  diff: string;
  added: number;
  removed: number;
}

type ParsedPatch =
  | { kind: 'add'; path: string; content: string }
  | { kind: 'delete'; path: string }
  | { kind: 'update'; path: string; moveTo?: string; hunks: PatchHunk[] };

type PlannedPatchChange = {
  kind: AppliedPatchChangeKind;
  path: string;
  absolutePath: string;
  moveTo?: string;
  absoluteMoveTo?: string;
  oldContent?: string;
  newContent?: string;
  diff: string;
  added: number;
  removed: number;
};

type PatchHunkLine = { op: 'context' | 'add' | 'remove'; text: string };
type PatchHunk = { lines: PatchHunkLine[] };

function countDiff(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added += 1;
    if (line.startsWith('-') && !line.startsWith('---')) removed += 1;
  }
  return { added, removed };
}

function ensurePatchEnvelope(lines: string[]): void {
  if (lines[0]?.trim() !== '*** Begin Patch') {
    throw new Error('Patch must start with "*** Begin Patch"');
  }
  if (lines[lines.length - 1]?.trim() !== '*** End Patch') {
    throw new Error('Patch must end with "*** End Patch"');
  }
}

function parsePatch(rawPatch: string): ParsedPatch[] {
  const lines = normalizeToLF(rawPatch).trimEnd().split('\n');
  ensurePatchEnvelope(lines);
  const ops: ParsedPatch[] = [];
  let i = 1;

  while (i < lines.length - 1) {
    const line = lines[i];
    if (line.startsWith('*** Add File: ')) {
      const path = line.slice('*** Add File: '.length).trim();
      i += 1;
      const body: string[] = [];
      while (i < lines.length - 1 && !lines[i].startsWith('*** ')) {
        const current = lines[i];
        if (!current.startsWith('+')) {
          throw new Error(`Add file ${path} contains a non-added line`);
        }
        body.push(current.slice(1));
        i += 1;
      }
      ops.push({ kind: 'add', path, content: `${body.join('\n')}${body.length > 0 ? '\n' : ''}` });
      continue;
    }

    if (line.startsWith('*** Delete File: ')) {
      ops.push({ kind: 'delete', path: line.slice('*** Delete File: '.length).trim() });
      i += 1;
      continue;
    }

    if (line.startsWith('*** Update File: ')) {
      const path = line.slice('*** Update File: '.length).trim();
      i += 1;
      let moveTo: string | undefined;
      if (lines[i]?.startsWith('*** Move to: ')) {
        moveTo = lines[i].slice('*** Move to: '.length).trim();
        i += 1;
      }
      const hunks: PatchHunk[] = [];
      while (i < lines.length - 1 && !lines[i].startsWith('*** ')) {
        if (!lines[i].startsWith('@@')) {
          throw new Error(`Update file ${path} expected "@@" hunk marker`);
        }
        i += 1;
        const hunkLines: PatchHunkLine[] = [];
        while (i < lines.length - 1 && !lines[i].startsWith('@@') && !lines[i].startsWith('*** ')) {
          const current = lines[i];
          const prefix = current[0];
          if (prefix === ' ') hunkLines.push({ op: 'context', text: current.slice(1) });
          else if (prefix === '+') hunkLines.push({ op: 'add', text: current.slice(1) });
          else if (prefix === '-') hunkLines.push({ op: 'remove', text: current.slice(1) });
          else throw new Error(`Update file ${path} has invalid hunk line prefix`);
          i += 1;
        }
        hunks.push({ lines: hunkLines });
      }
      ops.push({ kind: 'update', path, moveTo, hunks });
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }
    throw new Error(`Unknown patch operation: ${line}`);
  }

  if (ops.length === 0) throw new Error('Patch contains no operations');
  return ops;
}

function applyHunks(original: string, hunks: PatchHunk[], path: string): string {
  let content = normalizeToLF(original);
  for (const hunk of hunks) {
    const oldLines = hunk.lines
      .filter((line) => line.op === 'context' || line.op === 'remove')
      .map((line) => line.text);
    const newLines = hunk.lines
      .filter((line) => line.op === 'context' || line.op === 'add')
      .map((line) => line.text);
    const oldText = oldLines.join('\n');
    const newText = newLines.join('\n');
    const idx = content.indexOf(oldText);
    if (idx === -1) {
      const preview = oldText.split('\n').slice(0, 4).join('\\n');
      throw new Error(
        `Hunk did not match file: ${path}. Re-read the target lines and regenerate the patch with exact current context.${preview ? ` First unmatched context: ${preview}` : ''}`,
      );
    }
    content = `${content.slice(0, idx)}${newText}${content.slice(idx + oldText.length)}`;
  }
  return content;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
}

async function buildPatchPlan(
  workspace: string,
  parsed: ParsedPatch[],
  allowOutsideWorkspace: boolean,
): Promise<PlannedPatchChange[]> {
  const changes: PlannedPatchChange[] = [];
  const assertWritable = (path: string) => checkedFilePath(workspace, path, 'write', allowOutsideWorkspace);
  const readExisting = (path: string) => readWorkspaceFile(workspace, path, undefined, allowOutsideWorkspace).toString('utf8');
  const plannedTargets = new Set<string>();

  const rememberTarget = (target: string) => {
    if (plannedTargets.has(target)) {
      throw new Error(`Patch touches the same target multiple times: ${relative(workspace, target)}`);
    }
    plannedTargets.add(target);
  };

  for (const op of parsed) {
    if (op.kind === 'add') {
      const target = assertWritable(op.path);
      rememberTarget(target);
      if (await pathExists(target)) throw new Error(`Add file target already exists: ${op.path}`);
      const diff = generateDiffString('', op.content, op.path);
      const counts = countDiff(diff);
      changes.push({
        kind: 'add',
        path: op.path,
        absolutePath: target,
        newContent: op.content,
        ...counts,
        diff,
      });
      continue;
    }

    if (op.kind === 'delete') {
      const target = assertWritable(op.path);
      rememberTarget(target);
      const oldContent = readExisting(target);
      const diff = generateDiffString(oldContent, '', op.path);
      const counts = countDiff(diff);
      changes.push({
        kind: 'delete',
        path: op.path,
        absolutePath: target,
        oldContent,
        ...counts,
        diff,
      });
      continue;
    }

    const target = assertWritable(op.path);
    rememberTarget(target);
    const oldContent = readExisting(target);
    const lineEnding = detectLineEnding(oldContent);
    const newLfContent = applyHunks(normalizeToLF(oldContent), op.hunks, op.path);
    const newContent = restoreLineEndings(newLfContent, lineEnding);
    const destination = op.moveTo ? assertWritable(op.moveTo) : target;
    if (destination !== target) {
      rememberTarget(destination);
      if (await pathExists(destination)) {
        throw new Error(`Move target already exists: ${op.moveTo}`);
      }
    }
    const displayPath = op.moveTo ? `${op.path} -> ${op.moveTo}` : op.path;
    const diff = generateDiffString(oldContent, newContent, displayPath);
    const counts = countDiff(diff);
    changes.push({
      kind: op.moveTo ? 'move' : 'update',
      path: op.path,
      absolutePath: target,
      moveTo: op.moveTo,
      absoluteMoveTo: op.moveTo ? destination : undefined,
      oldContent,
      newContent,
      ...counts,
      diff,
    });
  }

  return changes;
}

async function commitPatchPlan(workspace: string, changes: PlannedPatchChange[], allowOutsideWorkspace: boolean): Promise<void> {
  const committed: PlannedPatchChange[] = [];
  try {
    for (const change of changes) {
      committed.push(change);
      if (change.kind === 'add') {
        writeWorkspaceFile(workspace, change.absolutePath, change.newContent ?? '', allowOutsideWorkspace);
      } else if (change.kind === 'delete') {
        deleteWorkspaceFile(workspace, change.absolutePath, allowOutsideWorkspace);
      } else {
        const destination = change.absoluteMoveTo ?? change.absolutePath;
        writeWorkspaceFile(workspace, destination, change.newContent ?? '', allowOutsideWorkspace);
        if (destination !== change.absolutePath) {
          deleteWorkspaceFile(workspace, change.absolutePath, allowOutsideWorkspace);
        }
      }
    }
  } catch (error) {
    for (const change of committed.reverse()) {
      try {
        if (change.kind === 'add') {
          if (await pathExists(change.absolutePath)) deleteWorkspaceFile(workspace, change.absolutePath, allowOutsideWorkspace);
        } else if (change.kind === 'delete') {
          writeWorkspaceFile(workspace, change.absolutePath, change.oldContent ?? '', allowOutsideWorkspace);
        } else if (change.absoluteMoveTo) {
          if (await pathExists(change.absoluteMoveTo)) deleteWorkspaceFile(workspace, change.absoluteMoveTo, allowOutsideWorkspace);
          writeWorkspaceFile(workspace, change.absolutePath, change.oldContent ?? '', allowOutsideWorkspace);
        } else {
          writeWorkspaceFile(workspace, change.absolutePath, change.oldContent ?? '', allowOutsideWorkspace);
        }
      } catch {
        // Best-effort rollback; the original write error is more useful to the caller.
      }
    }
    throw error;
  }
}

export function createApplyPatchTool(workspace: string, allowOutsideWorkspace = false): AgentTool {
  return {
    name: 'apply_patch',
    label: 'Apply Patch',
    description: 'Apply a strict multi-file patch. Use this for code edits instead of shell redirection or write_file.',
    parameters: ApplyPatchSchema,
    mutatesWorkspace: true,
    mutationScope: 'workspace',
    supportsParallel: false,
    idempotent: false,
    requiresExclusiveWorkspaceLock: true,
    finalGuardRelevant: true,

    async execute(
      _toolCallId: string,
      params: { patch?: string },
    ): Promise<AgentToolResult<ApplyPatchDetails>> {
      try {
        const patch = params.patch ?? '';
        const parsed = parsePatch(patch);
        const canonicalWorkspace = allowOutsideWorkspace
          ? await realpath(workspace).catch(() => workspace)
          : checkedFilePath(workspace, workspace, 'write');
        const changes = await buildPatchPlan(canonicalWorkspace, parsed, allowOutsideWorkspace);
        await commitPatchPlan(canonicalWorkspace, changes, allowOutsideWorkspace);

        const diff = changes.map((change) => change.diff).join('\n');
        const added = changes.reduce((sum, change) => sum + change.added, 0);
        const removed = changes.reduce((sum, change) => sum + change.removed, 0);
        const files = changes.map((change) => {
          const target = change.absoluteMoveTo ?? change.absolutePath;
          const path = relative(canonicalWorkspace, target);
          return isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`) ? target : path;
        });
        const summary = changes
          .map((change) => {
            const display = change.moveTo ? `${change.path} -> ${change.moveTo}` : change.path;
            return `${change.kind}: ${display} (+${change.added}/-${change.removed})`;
          })
          .join('\n');

        return {
          content: [{ type: 'text', text: summary || 'Patch applied.' }],
          details: { changes, files, summary, diff, added, removed },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`apply_patch failed: ${message}`);
      }
    },
  } as any;
}

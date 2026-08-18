import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';

import { checkFileSafety } from '../prompt/safety.js';
import { evaluateFilePolicy } from '../sandbox/exec-policy.js';
import { detectLineEnding, generateDiffString, normalizeToLF, restoreLineEndings } from './edit-diff.js';
import { resolvePathUnderWorkspace } from './tool-paths.js';

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

async function readExisting(path: string): Promise<string> {
  return readFile(path, 'utf-8');
}

async function assertWritable(workspace: string, path: string): Promise<string> {
  const quick = checkFileSafety('write', path);
  if (!quick.allowed) throw new Error(quick.message ?? `Cannot write ${path}`);
  const policy = evaluateFilePolicy({ operation: 'write', path, workspaceRoot: workspace });
  if (!policy.allowed) throw new Error(`Sandbox: ${policy.reason}`);
  return resolvePathUnderWorkspace(path, workspace);
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
): Promise<PlannedPatchChange[]> {
  const changes: PlannedPatchChange[] = [];
  const plannedTargets = new Set<string>();

  const rememberTarget = (target: string) => {
    if (plannedTargets.has(target)) {
      throw new Error(`Patch touches the same target multiple times: ${relative(workspace, target)}`);
    }
    plannedTargets.add(target);
  };

  for (const op of parsed) {
    if (op.kind === 'add') {
      const target = await assertWritable(workspace, op.path);
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
      const target = await assertWritable(workspace, op.path);
      rememberTarget(target);
      const oldContent = await readExisting(target);
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

    const target = await assertWritable(workspace, op.path);
    rememberTarget(target);
    const oldContent = await readExisting(target);
    const lineEnding = detectLineEnding(oldContent);
    const newLfContent = applyHunks(normalizeToLF(oldContent), op.hunks, op.path);
    const newContent = restoreLineEndings(newLfContent, lineEnding);
    const destination = op.moveTo ? await assertWritable(workspace, op.moveTo) : target;
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

async function commitPatchPlan(changes: PlannedPatchChange[]): Promise<void> {
  const committed: PlannedPatchChange[] = [];
  try {
    for (const change of changes) {
      committed.push(change);
      if (change.kind === 'add') {
        await mkdir(dirname(change.absolutePath), { recursive: true });
        await writeFile(change.absolutePath, change.newContent ?? '', 'utf-8');
      } else if (change.kind === 'delete') {
        await rm(change.absolutePath);
      } else {
        const destination = change.absoluteMoveTo ?? change.absolutePath;
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, change.newContent ?? '', 'utf-8');
        if (destination !== change.absolutePath) {
          await rm(change.absolutePath);
        }
      }
    }
  } catch (error) {
    for (const change of committed.reverse()) {
      try {
        if (change.kind === 'add') {
          await rm(change.absolutePath, { force: true });
        } else if (change.kind === 'delete') {
          await mkdir(dirname(change.absolutePath), { recursive: true });
          await writeFile(change.absolutePath, change.oldContent ?? '', 'utf-8');
        } else if (change.absoluteMoveTo) {
          await rm(change.absoluteMoveTo, { force: true });
          await mkdir(dirname(change.absolutePath), { recursive: true });
          await writeFile(change.absolutePath, change.oldContent ?? '', 'utf-8');
        } else {
          await writeFile(change.absolutePath, change.oldContent ?? '', 'utf-8');
        }
      } catch {
        // Best-effort rollback; the original write error is more useful to the caller.
      }
    }
    throw error;
  }
}

export function createApplyPatchTool(workspace: string): AgentTool {
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
        const changes = await buildPatchPlan(workspace, parsed);
        await commitPatchPlan(changes);

        const diff = changes.map((change) => change.diff).join('\n');
        const added = changes.reduce((sum, change) => sum + change.added, 0);
        const removed = changes.reduce((sum, change) => sum + change.removed, 0);
        const files = changes.map((change) => relative(workspace, change.absoluteMoveTo ?? change.absolutePath));
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

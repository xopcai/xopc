import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';

import { checkFileSafety } from '../prompt/safety.js';
import { evaluateFilePolicy } from '../sandbox/exec-policy.js';
import { generateDiffString, normalizeToLF } from './edit-diff.js';
import { resolvePathUnderWorkspace } from './tool-paths.js';
import type { GoalEvidenceRecordInput } from './goal-evidence-recorder.js';

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

export interface CreateApplyPatchToolOptions {
  recordGoalEvidence?: (input: GoalEvidenceRecordInput) => Promise<void> | void;
}

type ParsedPatch =
  | { kind: 'add'; path: string; content: string }
  | { kind: 'delete'; path: string }
  | { kind: 'update'; path: string; moveTo?: string; hunks: PatchHunk[] };

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
  return normalizeToLF(await readFile(path, 'utf-8'));
}

async function assertWritable(workspace: string, path: string): Promise<string> {
  const quick = checkFileSafety('write', path);
  if (!quick.allowed) throw new Error(quick.message ?? `Cannot write ${path}`);
  const policy = evaluateFilePolicy({ operation: 'write', path, workspaceRoot: workspace });
  if (!policy.allowed) throw new Error(`Sandbox: ${policy.reason}`);
  return resolvePathUnderWorkspace(path, workspace);
}

export function createApplyPatchTool(
  workspace: string,
  options?: CreateApplyPatchToolOptions,
): AgentTool {
  return {
    name: 'apply_patch',
    label: 'Apply Patch',
    description: 'Apply a strict multi-file patch. Use this for code edits instead of shell redirection or write_file.',
    parameters: ApplyPatchSchema,

    async execute(
      _toolCallId: string,
      params: { patch?: string },
    ): Promise<AgentToolResult<ApplyPatchDetails>> {
      try {
        const patch = params.patch ?? '';
        const parsed = parsePatch(patch);
        const changes: AppliedPatchChange[] = [];

        for (const op of parsed) {
          if (op.kind === 'add') {
            const target = await assertWritable(workspace, op.path);
            let exists = false;
            try {
              await stat(target);
              exists = true;
            } catch (e) {
              if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
            }
            if (exists) throw new Error(`Add file target already exists: ${op.path}`);
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, op.content, 'utf-8');
            const diff = generateDiffString('', op.content, op.path);
            const counts = countDiff(diff);
            changes.push({
              kind: 'add',
              path: op.path,
              absolutePath: target,
              ...counts,
              diff,
            });
            continue;
          }

          if (op.kind === 'delete') {
            const target = await assertWritable(workspace, op.path);
            const oldContent = await readExisting(target);
            await rm(target);
            const diff = generateDiffString(oldContent, '', op.path);
            const counts = countDiff(diff);
            changes.push({
              kind: 'delete',
              path: op.path,
              absolutePath: target,
              ...counts,
              diff,
            });
            continue;
          }

          const target = await assertWritable(workspace, op.path);
          const oldContent = await readExisting(target);
          const newContent = applyHunks(oldContent, op.hunks, op.path);
          const destination = op.moveTo ? await assertWritable(workspace, op.moveTo) : target;
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, newContent, 'utf-8');
          if (destination !== target) {
            await rm(target);
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
            ...counts,
            diff,
          });
        }

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

        await options?.recordGoalEvidence?.({
          kind: 'diff',
          title: `Patch applied: ${changes.length} file${changes.length === 1 ? '' : 's'}`,
          summary: diff.slice(0, 4000),
          uri: changes.length === 1 ? changes[0].absoluteMoveTo ?? changes[0].absolutePath : undefined,
          data: {
            files,
            added,
            removed,
          },
        });

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

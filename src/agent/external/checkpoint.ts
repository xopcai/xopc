import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runExec } from '../../infra/exec.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('ExternalCheckpoint');

const CHECKPOINT_GIT_TIMEOUT_MS = 15_000;
const MAX_CHECKPOINT_DIFF_CHARS = 128_000;
const CHECKPOINT_REF_PREFIX = 'refs/xopc/checkpoints';

export type TurnCheckpointFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export type TurnCheckpointDiff = {
  files: Array<{ path: string; status: TurnCheckpointFileStatus }>;
  added: number;
  removed: number;
  diff: string;
  diffTruncated: boolean;
  beforeRef?: string;
  afterRef?: string;
};

function sanitizeRefSegment(raw: string): string {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned || 'unknown';
}

export function checkpointRefName(
  conversationId: string,
  turnId: string,
  stage: 'before' | 'after',
): string {
  return `${CHECKPOINT_REF_PREFIX}/${sanitizeRefSegment(conversationId)}/${sanitizeRefSegment(turnId)}/${stage}`;
}

async function execGit(
  cwd: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  const result = await runExec('git', args, {
    cwd,
    env: env ? { ...process.env, ...env } : undefined,
    timeoutMs: CHECKPOINT_GIT_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
  return result.stdout;
}

async function resolveGitRoot(cwd: string): Promise<string | null> {
  try {
    const out = (await execGit(cwd, ['rev-parse', '--show-toplevel'])).trim();
    return out || null;
  } catch {
    return null;
  }
}

async function snapshotWorkingTreeToTreeSha(repoRoot: string): Promise<string> {
  const tempIndex = join(tmpdir(), `xopc-ckpt-idx-${process.pid}-${randomUUID()}`);
  const env = { GIT_INDEX_FILE: tempIndex };
  try {
    // Capture tracked + untracked (non-ignored) files into an isolated temporary index
    // so the user's real Git index, HEAD, branches, and stash are never touched.
    await execGit(repoRoot, ['add', '-A'], env);
    const treeSha = (await execGit(repoRoot, ['write-tree'], env)).trim();
    if (!treeSha) throw new Error('git write-tree returned empty SHA');
    return treeSha;
  } finally {
    await rm(tempIndex, { force: true }).catch(() => {});
  }
}

/**
 * Capture a non-invasive Git snapshot of the workspace into `refs/xopc/checkpoints/<conv>/<turn>/<stage>`.
 * Returns the stored ref name and tree SHA, or `null` if `cwd` is not a Git repository.
 */
export async function captureTurnCheckpoint(input: {
  cwd: string;
  conversationId: string;
  turnId: string;
  stage: 'before' | 'after';
}): Promise<{ ref: string; treeSha: string; commitSha: string } | null> {
  const repoRoot = await resolveGitRoot(input.cwd);
  if (!repoRoot) return null;

  try {
    const treeSha = await snapshotWorkingTreeToTreeSha(repoRoot);
    const parentSha = await execGit(repoRoot, ['rev-parse', '--verify', 'HEAD^{commit}'])
      .then((out) => out.trim())
      .catch(() => '');
    const commitArgs = [
      'commit-tree',
      treeSha,
      ...(parentSha ? ['-p', parentSha] : []),
      '-m',
      `xopc checkpoint ${input.stage} ${input.turnId}`,
    ];
    const commitSha = (await execGit(repoRoot, commitArgs, {
      GIT_AUTHOR_NAME: 'xopc',
      GIT_AUTHOR_EMAIL: 'checkpoint@xopc.local',
      GIT_COMMITTER_NAME: 'xopc',
      GIT_COMMITTER_EMAIL: 'checkpoint@xopc.local',
    })).trim();
    const ref = checkpointRefName(input.conversationId, input.turnId, input.stage);
    await execGit(repoRoot, ['update-ref', ref, commitSha]);
    return { ref, treeSha, commitSha };
  } catch (error) {
    log.debug(
      { err: error, cwd: input.cwd, conversationId: input.conversationId, turnId: input.turnId, stage: input.stage },
      'Turn checkpoint capture skipped',
    );
    return null;
  }
}

async function resolveCheckpointTree(repoRoot: string, ref: string): Promise<string | null> {
  try {
    const sha = (await execGit(repoRoot, ['rev-parse', '--verify', `${ref}^{tree}`])).trim();
    return sha || null;
  } catch {
    return null;
  }
}

function mapGitNameStatus(code: string): TurnCheckpointFileStatus {
  const c = code.trim().toUpperCase();
  if (c.startsWith('A')) return 'added';
  if (c.startsWith('D')) return 'deleted';
  if (c.startsWith('R') || c.startsWith('C')) return 'renamed';
  return 'modified';
}

/**
 * Compute exact file statuses, +/- line stats, and unified diff between a turn's `before` and `after` checkpoints.
 */
export async function computeTurnCheckpointDiff(input: {
  cwd: string;
  conversationId: string;
  turnId: string;
  maxDiffChars?: number;
}): Promise<TurnCheckpointDiff | null> {
  const repoRoot = await resolveGitRoot(input.cwd);
  if (!repoRoot) return null;

  const beforeRef = checkpointRefName(input.conversationId, input.turnId, 'before');
  const afterRef = checkpointRefName(input.conversationId, input.turnId, 'after');
  const [beforeTree, afterTree] = await Promise.all([
    resolveCheckpointTree(repoRoot, beforeRef),
    resolveCheckpointTree(repoRoot, afterRef),
  ]);
  if (!beforeTree || !afterTree) return null;
  if (beforeTree === afterTree) {
    return { files: [], added: 0, removed: 0, diff: '', diffTruncated: false, beforeRef, afterRef };
  }

  const [nameStatusRaw, numstatRaw, patchRaw] = await Promise.all([
    execGit(repoRoot, ['diff', '--name-status', '--no-renames', beforeTree, afterTree]),
    execGit(repoRoot, ['diff', '--numstat', '--no-renames', beforeTree, afterTree]),
    execGit(repoRoot, ['diff', '--unified=3', '--no-color', beforeTree, afterTree]),
  ]);

  const files: Array<{ path: string; status: TurnCheckpointFileStatus }> = [];
  for (const line of nameStatusRaw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [statusCode, ...rest] = line.split('\t');
    const path = rest.join('\t').trim();
    if (!statusCode || !path) continue;
    files.push({ path, status: mapGitNameStatus(statusCode) });
  }

  let added = 0;
  let removed = 0;
  for (const line of numstatRaw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [addRaw, delRaw] = line.split('\t');
    const a = Number.parseInt(addRaw ?? '', 10);
    const d = Number.parseInt(delRaw ?? '', 10);
    if (Number.isFinite(a)) added += a;
    if (Number.isFinite(d)) removed += d;
  }

  const limit = input.maxDiffChars ?? MAX_CHECKPOINT_DIFF_CHARS;
  const diffTruncated = patchRaw.length > limit;
  const diff = diffTruncated ? patchRaw.slice(0, limit) : patchRaw;

  return {
    files,
    added,
    removed,
    diff,
    diffTruncated,
    beforeRef,
    afterRef,
  };
}

type RestoreCheckpointInput = {
  cwd: string;
  conversationId: string;
  turnId: string;
  stage?: 'before' | 'after';
};

/** Apply only the turn's change, keeping unrelated working tree and index changes. */
export async function restoreTurnCheckpoint(
  input: RestoreCheckpointInput,
  options: { checkOnly?: boolean; optional?: boolean } = {},
): Promise<{ restored: boolean; filesChanged: number; stage: 'before' | 'after' }> {
  const stage = input.stage ?? 'before';
  const unchanged = { restored: false, filesChanged: 0, stage };
  const repoRoot = await resolveGitRoot(input.cwd);
  if (!repoRoot) {
    if (options.optional) return unchanged;
    throw new Error('Workspace is not a Git repository; file checkpoint restore is unavailable.');
  }

  const from = checkpointRefName(input.conversationId, input.turnId, stage === 'before' ? 'after' : 'before');
  const to = checkpointRefName(input.conversationId, input.turnId, stage);
  const [fromTree, toTree] = await Promise.all([
    resolveCheckpointTree(repoRoot, from),
    resolveCheckpointTree(repoRoot, to),
  ]);
  if (!fromTree || !toTree) {
    if (options.optional && !fromTree && !toTree) return unchanged;
    throw new Error('Both turn checkpoints are required to restore the change safely.');
  }
  if (fromTree === toTree) return { ...unchanged, restored: true };

  const dir = await mkdtemp(join(tmpdir(), 'xopc-ckpt-restore-'));
  try {
    const patch = join(dir, 'turn.patch');
    const diffOptions = ['--no-renames', '--no-relative', '--no-ext-diff', '--no-textconv'];
    const changed = await execGit(repoRoot, ['diff', ...diffOptions, '--name-only', '-z', fromTree, toTree]);
    await execGit(repoRoot, ['-c', 'core.quotePath=true', 'diff', ...diffOptions,
      '--binary', '--full-index', '--no-color', '--src-prefix=a/', '--dst-prefix=b/',
      `--output=${patch}`, fromTree, toTree]);
    const args = ['apply', '--binary', '--whitespace=nowarn', patch];
    const check = options.checkOnly ? ['--check'] : [];
    try {
      await execGit(repoRoot, [...args.slice(0, 1), ...check, ...args.slice(1)]);
    } catch (error) {
      // Retrying a completed restore is a no-op.
      try {
        await execGit(repoRoot, ['apply', '--check', '--reverse', ...args.slice(1)]);
      } catch {
        throw new Error('Workspace files changed after this turn and conflict with the restore.', { cause: error });
      }
      return { ...unchanged, restored: true };
    }
    return { restored: !options.checkOnly, filesChanged: changed.split('\0').filter(Boolean).length, stage };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Check whether a turn has stored `before` / `after` checkpoint refs. */
export async function hasTurnCheckpoint(input: {
  cwd: string;
  conversationId: string;
  turnId: string;
}): Promise<{ hasBefore: boolean; hasAfter: boolean }> {
  const repoRoot = await resolveGitRoot(input.cwd);
  if (!repoRoot) return { hasBefore: false, hasAfter: false };
  const [beforeTree, afterTree] = await Promise.all([
    resolveCheckpointTree(repoRoot, checkpointRefName(input.conversationId, input.turnId, 'before')),
    resolveCheckpointTree(repoRoot, checkpointRefName(input.conversationId, input.turnId, 'after')),
  ]);
  return { hasBefore: Boolean(beforeTree), hasAfter: Boolean(afterTree) };
}

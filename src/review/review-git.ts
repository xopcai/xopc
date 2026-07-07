import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type ReviewTarget =
  | { kind: 'uncommitted'; instructions?: string }
  | { kind: 'base_branch'; baseBranch: string; instructions?: string }
  | { kind: 'commit'; sha: string; title?: string; instructions?: string };

export interface ReviewDiffBundle {
  cwd: string;
  target: ReviewTarget;
  targetLabel: string;
  status: string;
  stat: string;
  diff: string;
}

export interface ReviewContextBranch {
  name: string;
  current?: boolean;
  remote?: boolean;
}

export interface ReviewContextCommit {
  sha: string;
  shortSha: string;
  subject: string;
  date?: string;
}

export interface ReviewContext {
  cwd: string;
  defaultBaseBranch?: string;
  status: {
    changedFiles: number;
    untrackedFiles: number;
    isClean: boolean;
  };
  branches: ReviewContextBranch[];
  commits: ReviewContextCommit[];
}

export async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
}

async function gitDiffNoIndex(args: string[], cwd: string): Promise<string> {
  try {
    return await git(args, cwd);
  } catch (err) {
    const rec = err && typeof err === 'object' ? err as Record<string, unknown> : {};
    if (typeof rec.stdout === 'string') return rec.stdout;
    throw err;
  }
}

export async function resolveGitRoot(workspace: string): Promise<string> {
  const root = (await git(['rev-parse', '--show-toplevel'], workspace)).trim();
  return root || workspace;
}

async function untrackedFileDiff(cwd: string): Promise<string> {
  const raw = await git(['ls-files', '--others', '--exclude-standard', '-z'], cwd).catch(() => '');
  const files = raw.split('\0').map((item) => item.trim()).filter(Boolean);
  if (files.length === 0) return '';

  const chunks: string[] = [];
  for (const file of files) {
    const diff = await gitDiffNoIndex(['diff', '--no-index', '--', '/dev/null', file], cwd).catch(() => '');
    if (diff.trim()) chunks.push(diff);
  }
  return chunks.join('\n');
}

function splitArgs(input: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (const ch of input) {
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (escaped) cur += '\\';
  if (cur) out.push(cur);
  return out;
}

function readOptionValue(tokens: string[], index: number, flag: string): { value: string; next: number } {
  const token = tokens[index] ?? '';
  const eq = token.indexOf('=');
  if (eq > -1) {
    return { value: token.slice(eq + 1), next: index + 1 };
  }
  const value = tokens[index + 1] ?? '';
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return { value, next: index + 2 };
}

export function parseReviewTargetArgs(args: string): ReviewTarget {
  const tokens = splitArgs(args.trim());
  let kind: ReviewTarget['kind'] | undefined;
  let baseBranch = '';
  let sha = '';
  let instructions = '';
  const free: string[] = [];

  for (let i = 0; i < tokens.length;) {
    const token = tokens[i]!;
    if (token === '--uncommitted') {
      kind = 'uncommitted';
      i += 1;
      continue;
    }
    if (token === '--base' || token.startsWith('--base=')) {
      const value = readOptionValue(tokens, i, '--base');
      kind = 'base_branch';
      baseBranch = value.value.trim();
      i = value.next;
      continue;
    }
    if (token === '--commit' || token.startsWith('--commit=')) {
      const value = readOptionValue(tokens, i, '--commit');
      kind = 'commit';
      sha = value.value.trim();
      i = value.next;
      continue;
    }
    if (token === '--custom' || token === '--instructions') {
      instructions = tokens.slice(i + 1).join(' ').trim();
      break;
    }
    if (token.startsWith('--custom=') || token.startsWith('--instructions=')) {
      instructions = token.slice(token.indexOf('=') + 1).trim();
      i += 1;
      continue;
    }
    free.push(token);
    i += 1;
  }

  const extraInstructions = instructions || free.join(' ').trim();
  if (!kind) kind = 'uncommitted';
  if (kind === 'base_branch') {
    if (!baseBranch) throw new Error('Missing base branch for review.');
    return { kind, baseBranch, ...(extraInstructions ? { instructions: extraInstructions } : {}) };
  }
  if (kind === 'commit') {
    if (!sha) throw new Error('Missing commit SHA for review.');
    return { kind, sha, ...(extraInstructions ? { instructions: extraInstructions } : {}) };
  }
  return { kind: 'uncommitted', ...(extraInstructions ? { instructions: extraInstructions } : {}) };
}

async function buildUncommittedReview(cwd: string, target: ReviewTarget & { kind: 'uncommitted' }): Promise<ReviewDiffBundle> {
  const status = await git(['status', '--short'], cwd).catch(() => '');
  const stat = await git(['diff', '--stat', 'HEAD', '--'], cwd).catch(() => '');
  const trackedDiff = await git(['diff', '--find-renames', 'HEAD', '--'], cwd).catch(() => '');
  const untrackedDiff = await untrackedFileDiff(cwd);
  return {
    cwd,
    target,
    targetLabel: 'uncommitted changes',
    status,
    stat,
    diff: [trackedDiff, untrackedDiff].filter((part) => part.trim()).join('\n'),
  };
}

async function buildBaseBranchReview(cwd: string, target: ReviewTarget & { kind: 'base_branch' }): Promise<ReviewDiffBundle> {
  const mergeBase = (await git(['merge-base', 'HEAD', target.baseBranch], cwd)).trim();
  const status = await git(['status', '--short'], cwd).catch(() => '');
  const stat = await git(['diff', '--stat', mergeBase, 'HEAD', '--'], cwd).catch(() => '');
  const diff = await git(['diff', '--find-renames', mergeBase, 'HEAD', '--'], cwd).catch(() => '');
  return {
    cwd,
    target,
    targetLabel: `changes against ${target.baseBranch} (merge-base ${mergeBase.slice(0, 12)})`,
    status,
    stat,
    diff,
  };
}

async function buildCommitReview(cwd: string, target: ReviewTarget & { kind: 'commit' }): Promise<ReviewDiffBundle> {
  const title = (await git(['log', '-1', '--format=%s', target.sha], cwd)).trim();
  const nextTarget: ReviewTarget = {
    ...target,
    ...(title ? { title } : {}),
  };
  const stat = await git(['show', '--stat', '--format=', '--find-renames', target.sha, '--'], cwd);
  const diff = await git(['show', '--format=fuller', '--find-renames', '--patch', target.sha, '--'], cwd);
  return {
    cwd,
    target: nextTarget,
    targetLabel: `commit ${target.sha}${title ? ` (${title})` : ''}`,
    status: '',
    stat,
    diff,
  };
}

export async function buildReviewDiffBundle(cwd: string, target: ReviewTarget): Promise<ReviewDiffBundle> {
  if (target.kind === 'base_branch') return buildBaseBranchReview(cwd, target);
  if (target.kind === 'commit') return buildCommitReview(cwd, target);
  return buildUncommittedReview(cwd, target);
}

function parseStatusCounts(status: string): ReviewContext['status'] {
  let changedFiles = 0;
  let untrackedFiles = 0;
  for (const line of status.split('\n')) {
    if (!line.trim()) continue;
    if (line.startsWith('??')) untrackedFiles += 1;
    else changedFiles += 1;
  }
  return {
    changedFiles,
    untrackedFiles,
    isClean: changedFiles === 0 && untrackedFiles === 0,
  };
}

function normalizeBranchName(raw: string): string {
  return raw.replace(/^remotes\//, '').trim();
}

async function listBranches(cwd: string): Promise<ReviewContextBranch[]> {
  const raw = await git(['branch', '--all', '--format=%(refname:short)|%(HEAD)'], cwd).catch(() => '');
  const seen = new Set<string>();
  const out: ReviewContextBranch[] = [];
  for (const line of raw.split('\n')) {
    const [nameRaw, headRaw] = line.split('|');
    const name = normalizeBranchName(nameRaw ?? '');
    if (!name || name.includes('HEAD ->') || seen.has(name)) continue;
    seen.add(name);
    const item: ReviewContextBranch = { name };
    if (headRaw?.trim() === '*') item.current = true;
    if (name.includes('/')) item.remote = true;
    out.push(item);
  }
  return out;
}

async function listCommits(cwd: string): Promise<ReviewContextCommit[]> {
  const raw = await git(['log', '--date=iso-strict', '--format=%H%x00%h%x00%s%x00%aI', '-n', '100'], cwd).catch(() => '');
  return raw
    .split('\n')
    .map((line): ReviewContextCommit | null => {
      const [sha, shortSha, subject, date] = line.split('\0');
      if (!sha || !shortSha || !subject) return null;
      const item: ReviewContextCommit = { sha, shortSha, subject };
      if (date) item.date = date;
      return item;
    })
    .filter((item): item is ReviewContextCommit => item != null);
}

function defaultBaseBranch(branches: ReviewContextBranch[]): string | undefined {
  const preferred = ['origin/main', 'main', 'origin/master', 'master', 'develop'];
  for (const name of preferred) {
    if (branches.some((branch) => branch.name === name)) return name;
  }
  return branches.find((branch) => branch.remote && !branch.current)?.name
    ?? branches.find((branch) => !branch.current)?.name;
}

export async function buildReviewContext(cwd: string): Promise<ReviewContext> {
  const statusRaw = await git(['status', '--short'], cwd).catch(() => '');
  const branches = await listBranches(cwd);
  const commits = await listCommits(cwd);
  const context: ReviewContext = {
    cwd,
    status: parseStatusCounts(statusRaw),
    branches,
    commits,
  };
  const base = defaultBaseBranch(branches);
  if (base) context.defaultBaseBranch = base;
  return context;
}

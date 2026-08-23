import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { inferProjectKind } from '../projects/index.js';

import type { WorkDiscoveryCandidate, WorkDiscoveryCandidateSource } from './types.js';

const execFileAsync = promisify(execFile);

const COMMON_WORK_ROOT_NAMES = ['develop', 'Developer', 'Projects', 'workspace', 'code', 'src'];
const PERSONAL_WORK_ROOT_NAMES = ['Desktop', 'Documents', 'Downloads'];
const MAX_ROOT_CHILDREN = 100;
const GIT_TIMEOUT_MS = 2_500;
const RECENT_GENERAL_WORK_MS = 90 * 86_400_000;
const GENERAL_WORK_EXTENSIONS = new Set([
  '.doc', '.docx', '.md', '.odt', '.pdf', '.ppt', '.pptx', '.rtf', '.txt', '.xls', '.xlsx',
]);

interface CandidateInput {
  rootPath: string;
  source: WorkDiscoveryCandidateSource;
  projectId?: string;
}

interface GitCandidateSignal {
  branch?: string;
  changedFileCount: number;
  lastCommitAt?: number;
}

export interface DiscoverWorkCandidatesOptions {
  existingProjects?: Array<{ id: string; workspaceRoot?: string }>;
  approvedDirectories?: Array<{ id: string; rootPath: string }>;
  homeDirectory?: string;
  nowMs?: number;
  signal?: AbortSignal;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Work discovery canceled', 'AbortError');
}

async function readableDirectory(path: string): Promise<string | null> {
  try {
    const canonical = await realpath(path);
    const info = await stat(canonical);
    if (!info.isDirectory()) return null;
    await access(canonical, fsConstants.R_OK);
    return canonical;
  } catch {
    return null;
  }
}

async function gitSignal(rootPath: string, signal?: AbortSignal): Promise<GitCandidateSignal> {
  try {
    const [{ stdout: statusOutput }, { stdout: commitOutput }] = await Promise.all([
      execFileAsync('git', ['-C', rootPath, 'status', '--short', '--branch', '--untracked-files=no'], {
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 128 * 1024,
        signal,
      }),
      execFileAsync('git', ['-C', rootPath, 'log', '-1', '--format=%ct'], {
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 16 * 1024,
        signal,
      }),
    ]);
    const statusLines = statusOutput.split('\n').filter(Boolean);
    const branch = statusLines[0]?.startsWith('## ')
      ? statusLines[0].slice(3).split('...')[0]?.trim()
      : undefined;
    const timestamp = Number(commitOutput.trim()) * 1_000;
    return {
      ...(branch ? { branch } : {}),
      changedFileCount: Math.min(100, Math.max(0, statusLines.length - 1)),
      ...(Number.isFinite(timestamp) && timestamp > 0 ? { lastCommitAt: timestamp } : {}),
    };
  } catch {
    return { changedFileCount: 0 };
  }
}

async function recentGeneralWorkAt(rootPath: string, nowMs: number): Promise<number | undefined> {
  const entries = await readdir(rootPath, { withFileTypes: true }).catch(() => []);
  let latest: number | undefined;
  for (const entry of entries.slice(0, MAX_ROOT_CHILDREN)) {
    if (!entry.isFile() || entry.name.startsWith('.') || !GENERAL_WORK_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
    const info = await stat(join(rootPath, entry.name)).catch(() => null);
    if (!info?.isFile() || nowMs - info.mtimeMs > RECENT_GENERAL_WORK_MS) continue;
    latest = latest == null ? info.mtimeMs : Math.max(latest, info.mtimeMs);
  }
  return latest;
}

async function isCodingRoot(rootPath: string): Promise<boolean> {
  if (inferProjectKind({ workspaceRoot: rootPath }).kind === 'coding') return true;
  return stat(join(rootPath, '.git')).then(() => true).catch(() => false);
}

function recencyScore(lastActiveAt: number | undefined, nowMs: number): number {
  if (!lastActiveAt) return 0;
  const ageDays = Math.max(0, (nowMs - lastActiveAt) / 86_400_000);
  if (ageDays <= 2) return 40;
  if (ageDays <= 7) return 34;
  if (ageDays <= 14) return 27;
  if (ageDays <= 30) return 19;
  if (ageDays <= 90) return 10;
  return 2;
}

async function probeCandidate(input: CandidateInput, nowMs: number, signal?: AbortSignal): Promise<WorkDiscoveryCandidate | null> {
  abortIfNeeded(signal);
  const rootPath = await readableDirectory(input.rootPath);
  if (!rootPath) return null;
  const [rootInfo, git, personalWorkAt] = await Promise.all([
    stat(rootPath),
    gitSignal(rootPath, signal),
    input.source === 'personal_work_root' ? recentGeneralWorkAt(rootPath, nowMs) : undefined,
  ]);
  abortIfNeeded(signal);
  const inference = inferProjectKind({ workspaceRoot: rootPath });
  if (input.source === 'common_work_root' && !git.lastCommitAt && inference.kind !== 'coding') return null;
  if (input.source === 'personal_work_root' && !git.lastCommitAt && inference.kind !== 'coding' && !personalWorkAt) return null;
  const lastActiveAt = Math.max(rootInfo.mtimeMs, git.lastCommitAt ?? 0, personalWorkAt ?? 0) || undefined;
  const score = Math.min(100, Math.round(
    recencyScore(lastActiveAt, nowMs)
    + (git.lastCommitAt ? 20 : 0)
    + Math.min(10, git.changedFileCount * 2)
    + Math.round(inference.confidence * 20),
  ));
  const evidence: string[] = [];
  if (git.lastCommitAt) evidence.push('recent Git activity');
  if (git.changedFileCount > 0) evidence.push(`${git.changedFileCount} changed files`);
  if (inference.reasons[0]) evidence.push(inference.reasons[0]);
  if (input.source === 'existing_project') evidence.push('already connected to xopc');
  if (input.source === 'approved_directory') evidence.push('previously approved work folder');
  return {
    id: input.projectId ? `project:${input.projectId}` : `path:${rootPath}`,
    rootPath,
    displayName: basename(rootPath),
    source: input.source,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    projectKind: inference.kind,
    projectKindConfidence: inference.confidence,
    score,
    ...(lastActiveAt ? { lastActiveAt } : {}),
    ...(git.branch ? { branch: git.branch } : {}),
    changedFileCount: git.changedFileCount,
    evidence: evidence.slice(0, 4),
  };
}

async function commonRootInputs(homeDirectory: string, signal?: AbortSignal): Promise<CandidateInput[]> {
  const inputs: CandidateInput[] = [];
  for (const name of COMMON_WORK_ROOT_NAMES) {
    abortIfNeeded(signal);
    const commonRoot = await readableDirectory(join(homeDirectory, name));
    if (!commonRoot) continue;
    let entries;
    try {
      entries = await readdir(commonRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name)).slice(0, MAX_ROOT_CHILDREN)) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const directPath = join(commonRoot, entry.name);
      if (await isCodingRoot(directPath)) {
        inputs.push({ rootPath: directPath, source: 'common_work_root' });
        continue;
      }
      const nestedEntries = await readdir(directPath, { withFileTypes: true }).catch(() => []);
      for (const nested of nestedEntries
        .sort((left, right) => left.name.localeCompare(right.name))
        .slice(0, MAX_ROOT_CHILDREN)) {
        abortIfNeeded(signal);
        if (!nested.isDirectory() || nested.name.startsWith('.')) continue;
        const nestedPath = join(directPath, nested.name);
        if (await isCodingRoot(nestedPath)) {
          inputs.push({ rootPath: nestedPath, source: 'common_work_root' });
        }
      }
    }
  }
  return inputs;
}

function resolveXdgPath(value: string, homeDirectory: string): string | null {
  const unquoted = value.trim().replace(/^"|"$/g, '');
  const expanded = unquoted.replace(/^\$HOME(?=\/|$)|^\$\{HOME\}(?=\/|$)/, homeDirectory);
  return isAbsolute(expanded) ? resolve(expanded) : null;
}

export async function resolvePersonalWorkRoots(
  homeDirectory: string,
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
): Promise<string[]> {
  const roots = PERSONAL_WORK_ROOT_NAMES.map((name) => join(homeDirectory, name));
  if (platform === 'win32') {
    for (const oneDrive of [environment.OneDrive, environment.OneDriveConsumer, environment.OneDriveCommercial]) {
      if (!oneDrive) continue;
      roots.push(...PERSONAL_WORK_ROOT_NAMES.map((name) => join(oneDrive, name)));
    }
  }
  if (platform === 'linux') {
    const config = await readFile(join(homeDirectory, '.config', 'user-dirs.dirs'), 'utf8').catch(() => '');
    for (const line of config.split('\n')) {
      const match = /^XDG_(?:DESKTOP|DOCUMENTS|DOWNLOAD)_DIR=(.+)$/.exec(line.trim());
      const path = match?.[1] ? resolveXdgPath(match[1], homeDirectory) : null;
      if (path) roots.push(path);
    }
  }
  return [...new Set(roots)];
}

async function personalRootInputs(
  roots: string[],
  nowMs: number,
  signal?: AbortSignal,
): Promise<CandidateInput[]> {
  const inputs: CandidateInput[] = [];
  for (const root of roots) {
    abortIfNeeded(signal);
    const readableRoot = await readableDirectory(root);
    if (!readableRoot) continue;
    const entries = await readdir(readableRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name)).slice(0, MAX_ROOT_CHILDREN)) {
      abortIfNeeded(signal);
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const directPath = join(readableRoot, entry.name);
      if (await isCodingRoot(directPath) || await recentGeneralWorkAt(directPath, nowMs)) {
        inputs.push({ rootPath: directPath, source: 'personal_work_root' });
        continue;
      }
      const nestedEntries = await readdir(directPath, { withFileTypes: true }).catch(() => []);
      for (const nested of nestedEntries
        .sort((left, right) => left.name.localeCompare(right.name))
        .slice(0, MAX_ROOT_CHILDREN)) {
        if (!nested.isDirectory() || nested.name.startsWith('.')) continue;
        const nestedPath = join(directPath, nested.name);
        if (await isCodingRoot(nestedPath) || await recentGeneralWorkAt(nestedPath, nowMs)) {
          inputs.push({ rootPath: nestedPath, source: 'personal_work_root' });
        }
      }
    }
  }
  return inputs;
}

export async function discoverWorkCandidates(
  options: DiscoverWorkCandidatesOptions = {},
): Promise<WorkDiscoveryCandidate[]> {
  const nowMs = options.nowMs ?? Date.now();
  const homeDirectory = options.homeDirectory ?? homedir();
  const existingInputs: CandidateInput[] = (options.existingProjects ?? []).flatMap((project) => {
    const rootPath = project.workspaceRoot?.trim();
    return rootPath ? [{ rootPath, source: 'existing_project' as const, projectId: project.id }] : [];
  });
  const approvedInputs: CandidateInput[] = (options.approvedDirectories ?? []).map((source) => ({
    rootPath: source.rootPath,
    source: 'approved_directory',
  }));
  const [commonInputs, personalInputs] = await Promise.all([
    commonRootInputs(homeDirectory, options.signal),
    resolvePersonalWorkRoots(homeDirectory, options.platform ?? process.platform, options.environment ?? process.env)
      .then((roots) => personalRootInputs(roots, nowMs, options.signal)),
  ]);
  const uniqueInputs = new Map<string, CandidateInput>();
  for (const input of [...existingInputs, ...approvedInputs, ...commonInputs, ...personalInputs]) {
    const existing = uniqueInputs.get(input.rootPath);
    if (!existing
      || input.source === 'existing_project'
      || (input.source === 'approved_directory' && existing.source !== 'existing_project')) {
      uniqueInputs.set(input.rootPath, input);
    }
  }
  const candidates: WorkDiscoveryCandidate[] = [];
  const inputs = [...uniqueInputs.values()];
  for (let index = 0; index < inputs.length; index += 4) {
    abortIfNeeded(options.signal);
    const batch = await Promise.all(inputs.slice(index, index + 4).map((input) => (
      probeCandidate(input, nowMs, options.signal)
    )));
    candidates.push(...batch.filter((item): item is WorkDiscoveryCandidate => Boolean(item)));
  }
  const canonicalCandidates = new Map<string, WorkDiscoveryCandidate>();
  for (const candidate of candidates) {
    const existing = canonicalCandidates.get(candidate.rootPath);
    if (!existing || candidate.source === 'existing_project') {
      canonicalCandidates.set(candidate.rootPath, candidate);
    }
  }
  return [...canonicalCandidates.values()]
    .sort((a, b) => b.score - a.score || (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0) || a.rootPath.localeCompare(b.rootPath))
    .slice(0, 8);
}

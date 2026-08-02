import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import { inferProjectKind } from '../projects/index.js';

import type { WorkContextSnapshot, WorkContextSnapshotSummary } from './types.js';

const execFileAsync = promisify(execFile);

export const WORK_DISCOVERY_SCAN_POLICY_VERSION = 1;

const MAX_DEPTH = 4;
const MAX_CANDIDATE_FILES = 2_000;
const MAX_CONTENT_FILES = 30;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024;

const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'vendor', 'dist', 'build', 'coverage', '.coverage',
  '.cache', '.next', '.nuxt', '.turbo', '.vite', '.pnpm-store', '__pycache__', '.venv', 'venv',
  'target', 'out', 'Pods', 'DerivedData',
]);

const BINARY_EXTENSIONS = new Set([
  '.7z', '.a', '.avi', '.bin', '.class', '.db', '.dmg', '.dll', '.eot', '.exe', '.gz', '.jar',
  '.lockb', '.mov', '.mp3', '.mp4', '.o', '.otf', '.pyc', '.rar', '.so', '.sqlite', '.sqlite3',
  '.tar', '.ttf', '.wav', '.webm', '.woff', '.woff2', '.zip',
]);

const METADATA_ONLY_EXTENSIONS = new Map<string, 'document' | 'pdf' | 'image'>([
  ['.doc', 'document'], ['.docx', 'document'], ['.ppt', 'document'], ['.pptx', 'document'],
  ['.xls', 'document'], ['.xlsx', 'document'], ['.pdf', 'pdf'],
  ['.bmp', 'image'], ['.gif', 'image'], ['.ico', 'image'], ['.jpeg', 'image'], ['.jpg', 'image'],
  ['.png', 'image'], ['.webp', 'image'],
]);

const SECRET_FILE_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /(?:^|[-_.])(credentials?|secrets?|tokens?|api[-_]?keys?|auth)(?:[-_.]|$)/i,
  /\.(?:pem|key|p12|pfx|crt|cer)$/i,
  /^(?:id_rsa|id_ed25519)(?:\.pub)?$/i,
];

const HIGH_VALUE_NAMES = [
  /^AGENTS\.md$/i,
  /^CONTEXT\.md$/i,
  /^README(?:\..+)?$/i,
  /^TODO(?:\..+)?$/i,
  /^ROADMAP(?:\..+)?$/i,
  /^CHANGELOG(?:\..+)?$/i,
  /^package\.json$/i,
  /^pyproject\.toml$/i,
  /^Cargo\.toml$/i,
  /^go\.mod$/i,
];

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Work discovery canceled', 'AbortError');
}

function isSecretFile(name: string): boolean {
  return SECRET_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

function isExcludedDirectory(name: string): boolean {
  return EXCLUDED_DIRECTORY_NAMES.has(name) || name.startsWith('.');
}

function isLikelyBinary(path: string): boolean {
  return BINARY_EXTENSIONS.has(extname(path).toLowerCase());
}

function isInsideRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function selectionPriority(path: string, modifiedAt: number): number {
  const name = basename(path);
  const highValueIndex = HIGH_VALUE_NAMES.findIndex((pattern) => pattern.test(name));
  if (highValueIndex >= 0) return 10_000 - highValueIndex * 100;
  return Math.floor(modifiedAt / 1_000_000);
}

async function gitInfo(root: string, signal?: AbortSignal): Promise<WorkContextSnapshot['git'] | undefined> {
  abortIfNeeded(signal);
  try {
    const [{ stdout: statusOutput }, { stdout: logOutput }] = await Promise.all([
      execFileAsync('git', ['-C', root, 'status', '--short', '--branch', '--untracked-files=no'], {
        timeout: 4_000,
        maxBuffer: 256 * 1024,
        signal,
      }),
      execFileAsync('git', ['-C', root, 'log', '-10', '--format=%ct%x09%s'], {
        timeout: 4_000,
        maxBuffer: 256 * 1024,
        signal,
      }),
    ]);
    const statusLines = statusOutput.split('\n').filter(Boolean);
    const branch = statusLines[0]?.startsWith('## ')
      ? statusLines[0].slice(3).split('...')[0]?.trim()
      : undefined;
    const changedPaths = statusLines.slice(1, 101).map((line) => line.slice(3).trim()).filter(Boolean);
    const recentCommits = logOutput.split('\n').filter(Boolean).slice(0, 10).map((line) => {
      const [timestamp, ...subjectParts] = line.split('\t');
      const committedAt = Number(timestamp) * 1000;
      return {
        subject: subjectParts.join('\t').slice(0, 240),
        ...(Number.isFinite(committedAt) ? { committedAt } : {}),
      };
    });
    return { ...(branch ? { branch } : {}), changedPaths, recentCommits };
  } catch {
    return undefined;
  }
}

async function metadataFingerprint(root: string, signal?: AbortSignal): Promise<string> {
  const entries: string[] = [];
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 2 || entries.length >= 300) return;
    abortIfNeeded(signal);
    const children = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entries.length >= 300) break;
      if (isSecretFile(child.name)) continue;
      if (child.isDirectory() && isExcludedDirectory(child.name)) continue;
      const absolutePath = resolve(directory, child.name);
      const relativePath = relative(root, absolutePath).replaceAll('\\', '/');
      if (child.isDirectory()) {
        await visit(absolutePath, depth + 1);
        continue;
      }
      const info = await lstat(absolutePath).catch(() => null);
      if (!info?.isFile() || info.isSymbolicLink()) continue;
      entries.push(`${relativePath}\0${info.size}\0${Math.floor(info.mtimeMs)}`);
    }
  };
  await visit(root, 0);
  return createHash('sha256').update(entries.join('\n')).digest('hex');
}

export async function canonicalWorkDiscoveryRoot(input: string): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed || !isAbsolute(trimmed)) throw new Error('An absolute folder path is required');
  const canonical = await realpath(trimmed);
  const info = await stat(canonical);
  if (!info.isDirectory()) throw new Error('Selected path is not a directory');
  await access(canonical, fsConstants.R_OK);
  return canonical;
}

export async function previewWorkDiscoveryRoot(rootPath: string) {
  const canonicalRootPath = await canonicalWorkDiscoveryRoot(rootPath);
  const inference = inferProjectKind({ workspaceRoot: canonicalRootPath });
  const git = await gitInfo(canonicalRootPath);
  const contentSignature = await metadataFingerprint(canonicalRootPath);
  const recentAreas = Array.from(new Set((git?.changedPaths ?? []).map((path) => {
    const normalized = path.replaceAll('\\', '/');
    const [first, second] = normalized.split('/');
    return second ? `${first}/${second}` : first;
  }).filter((area): area is string => Boolean(area)))).slice(0, 5);
  return {
    canonicalRootPath,
    displayName: basename(canonicalRootPath),
    projectKind: inference.kind,
    projectKindConfidence: inference.confidence,
    markerReasons: inference.reasons,
    fingerprint: {
      ...(git?.branch ? { branch: git.branch } : {}),
      changedFileCount: git?.changedPaths.length ?? 0,
      recentAreas,
      contentSignature,
      generatedAt: Date.now(),
    },
  };
}

export async function probeWorkDiscoveryRoot(
  rootPath: string,
  signal?: AbortSignal,
): Promise<WorkContextSnapshot> {
  const root = await canonicalWorkDiscoveryRoot(rootPath);
  const inference = inferProjectKind({ workspaceRoot: root });
  const candidates: Array<{ absolutePath: string; relativePath: string; modifiedAt: number; size: number }> = [];
  const metadataOnlyFiles: WorkContextSnapshot['structure']['metadataOnlyFiles'] = [];
  let omittedPathCount = 0;
  let traversalTruncated = false;

  const walk = async (directory: string, depth: number): Promise<void> => {
    abortIfNeeded(signal);
    if (candidates.length >= MAX_CANDIDATE_FILES) {
      traversalTruncated = true;
      return;
    }
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      abortIfNeeded(signal);
      if (candidates.length >= MAX_CANDIDATE_FILES) {
        traversalTruncated = true;
        omittedPathCount += 1;
        continue;
      }
      if (entry.isDirectory()) {
        if (depth >= MAX_DEPTH || isExcludedDirectory(entry.name)) {
          omittedPathCount += 1;
          continue;
        }
        await walk(resolve(directory, entry.name), depth + 1);
        continue;
      }
      if (!entry.isFile() || isSecretFile(entry.name)) {
        omittedPathCount += 1;
        continue;
      }
      const absolutePath = resolve(directory, entry.name);
      try {
        const resolvedPath = await realpath(absolutePath);
        if (!isInsideRoot(root, resolvedPath)) {
          omittedPathCount += 1;
          continue;
        }
        const info = await lstat(resolvedPath);
        if (!info.isFile()) {
          omittedPathCount += 1;
          continue;
        }
        const relativePath = relative(root, resolvedPath);
        const metadataKind = METADATA_ONLY_EXTENSIONS.get(extname(entry.name).toLowerCase());
        if (metadataKind) {
          if (metadataOnlyFiles.length < 200) {
            metadataOnlyFiles.push({ relativePath, modifiedAt: info.mtimeMs, size: info.size, kind: metadataKind });
          } else {
            omittedPathCount += 1;
          }
          continue;
        }
        if (isLikelyBinary(entry.name) || info.size > MAX_FILE_BYTES * 4) {
          omittedPathCount += 1;
          continue;
        }
        candidates.push({
          absolutePath: resolvedPath,
          relativePath,
          modifiedAt: info.mtimeMs,
          size: info.size,
        });
      } catch {
        omittedPathCount += 1;
      }
    }
  };

  await walk(root, 0);
  const git = await gitInfo(root, signal);
  const changed = new Set(git?.changedPaths ?? []);
  candidates.sort((a, b) => {
    const aScore = selectionPriority(a.relativePath, a.modifiedAt) + (changed.has(a.relativePath) ? 20_000 : 0);
    const bScore = selectionPriority(b.relativePath, b.modifiedAt) + (changed.has(b.relativePath) ? 20_000 : 0);
    return bScore - aScore || a.relativePath.localeCompare(b.relativePath);
  });

  const documents: WorkContextSnapshot['documents'] = [];
  let contentBytes = 0;
  for (const candidate of candidates) {
    abortIfNeeded(signal);
    if (documents.length >= MAX_CONTENT_FILES || contentBytes >= MAX_TOTAL_BYTES) break;
    const remaining = MAX_TOTAL_BYTES - contentBytes;
    const limit = Math.min(MAX_FILE_BYTES, remaining);
    try {
      const buffer = await readFile(candidate.absolutePath);
      const slice = buffer.subarray(0, limit);
      if (slice.includes(0)) continue;
      const excerpt = slice.toString('utf8').trim();
      if (!excerpt) continue;
      const highValue = HIGH_VALUE_NAMES.some((pattern) => pattern.test(basename(candidate.relativePath)));
      documents.push({
        relativePath: candidate.relativePath,
        modifiedAt: candidate.modifiedAt,
        excerpt,
        truncated: buffer.length > slice.length,
        selectionReason: changed.has(candidate.relativePath)
          ? 'git_change'
          : highValue
            ? 'project_context'
            : 'recently_modified',
      });
      contentBytes += slice.length;
    } catch {
      // Continue with the remaining readable files.
    }
  }

  return {
    root: {
      displayName: basename(root),
      projectKind: inference.kind,
      markerReasons: inference.reasons,
    },
    structure: {
      sampledPaths: [
        ...candidates.map((candidate) => candidate.relativePath),
        ...metadataOnlyFiles.map((file) => file.relativePath),
      ].slice(0, 200),
      metadataOnlyFiles,
      omittedPathCount,
    },
    ...(git ? { git } : {}),
    documents,
    limits: {
      policyVersion: WORK_DISCOVERY_SCAN_POLICY_VERSION,
      fileCount: candidates.length,
      contentBytes,
      truncated: traversalTruncated || candidates.length > 200 || documents.some((document) => document.truncated),
    },
  };
}

async function resolveWorkDiscoveryTextFile(rootPath: string, relativePath: string): Promise<{
  root: string;
  resolvedPath: string;
  relativePath: string;
  modifiedAt: number;
}> {
  const root = await canonicalWorkDiscoveryRoot(rootPath);
  const normalized = relativePath.trim().replaceAll('\\', '/');
  if (!normalized || isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw new Error('A safe relative path is required');
  }
  if (normalized.split('/').some((segment) => isExcludedDirectory(segment)) || isSecretFile(basename(normalized))) {
    throw new Error('The requested path is excluded by the scan policy');
  }
  if (isLikelyBinary(normalized) || METADATA_ONLY_EXTENSIONS.has(extname(normalized).toLowerCase())) {
    throw new Error('The requested path is not a readable text file');
  }
  const resolvedPath = await realpath(resolve(root, normalized));
  if (!isInsideRoot(root, resolvedPath)) throw new Error('The requested path is outside the approved folder');
  const info = await lstat(resolvedPath);
  if (!info.isFile() || info.size > MAX_FILE_BYTES * 4) throw new Error('The requested file is not eligible for investigation');
  return { root, resolvedPath, relativePath: relative(root, resolvedPath), modifiedAt: info.mtimeMs };
}

export async function readWorkDiscoveryTextExcerpt(input: {
  rootPath: string;
  relativePath: string;
  maxChars?: number;
  signal?: AbortSignal;
}): Promise<{ relativePath: string; excerpt: string; modifiedAt: number; truncated: boolean }> {
  abortIfNeeded(input.signal);
  const file = await resolveWorkDiscoveryTextFile(input.rootPath, input.relativePath);
  const maxChars = Math.max(500, Math.min(20_000, input.maxChars ?? 8_000));
  const buffer = await readFile(file.resolvedPath);
  abortIfNeeded(input.signal);
  if (buffer.includes(0)) throw new Error('The requested file appears to be binary');
  const text = buffer.toString('utf8');
  return {
    relativePath: file.relativePath,
    excerpt: text.slice(0, maxChars).trim(),
    modifiedAt: file.modifiedAt,
    truncated: text.length > maxChars,
  };
}

export async function searchWorkDiscoveryText(input: {
  rootPath: string;
  relativePaths: string[];
  query: string;
  signal?: AbortSignal;
}): Promise<Array<{ relativePath: string; excerpt: string; modifiedAt: number }>> {
  const query = input.query.trim().slice(0, 120);
  if (query.length < 2) throw new Error('Search query is too short');
  const needle = query.toLocaleLowerCase();
  const results: Array<{ relativePath: string; excerpt: string; modifiedAt: number }> = [];
  for (const relativePath of input.relativePaths.slice(0, 120)) {
    abortIfNeeded(input.signal);
    try {
      const file = await readWorkDiscoveryTextExcerpt({
        rootPath: input.rootPath,
        relativePath,
        maxChars: 20_000,
        signal: input.signal,
      });
      const index = file.excerpt.toLocaleLowerCase().indexOf(needle);
      if (index < 0) continue;
      const start = Math.max(0, index - 300);
      const end = Math.min(file.excerpt.length, index + query.length + 700);
      results.push({
        relativePath: file.relativePath,
        excerpt: file.excerpt.slice(start, end).trim(),
        modifiedAt: file.modifiedAt,
      });
      if (results.length >= 8) break;
    } catch {
      // Skip paths rejected by the scan policy or no longer readable.
    }
  }
  return results;
}

export function summarizeWorkContextSnapshot(snapshot: WorkContextSnapshot): WorkContextSnapshotSummary {
  return {
    projectKind: snapshot.root.projectKind,
    sampledPathCount: snapshot.structure.sampledPaths.length,
    omittedPathCount: snapshot.structure.omittedPathCount,
    documentCount: snapshot.documents.length,
    contentBytes: snapshot.limits.contentBytes,
    changedPathCount: snapshot.git?.changedPaths.length ?? 0,
    truncated: snapshot.limits.truncated,
  };
}

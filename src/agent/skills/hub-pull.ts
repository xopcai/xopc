/**
 * CLI / hub: install or update skills from git or archive (zip / tar.gz) into ~/.xopc/skills.
 */

import { execFileSync } from 'node:child_process';
import AdmZip from 'adm-zip';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, normalize, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { fetch } from 'undici';

import { parseFrontmatter } from '../../markdown/frontmatter.js';
import { computeSkillTreeHashSync } from './hub-hash.js';
import { getSkillsLockEntry, recordSkillsHubInstall } from './hub-lock.js';
import type { SkillHubKind } from './hub-lock.js';
import {
  installSkillFromZip,
  isIgnorableZipEntry,
  isValidSkillId,
  prepareManagedSkillTempDir,
  promoteManagedSkillTempDir,
} from './managed-store.js';
import { formatScanSummary, scanSkillDirectory } from './scanner.js';

export interface HubPullOptions {
  skillId?: string;
  ref?: string;
  subpath?: string;
  force?: boolean;
  /** Destination skills root. Defaults to the global managed skills directory. */
  installRoot?: string;
  /** Hub lock path. Defaults to the global skills-lock.json. */
  lockPath?: string;
  /** When true, critical scanner findings fail the install. */
  strictScan?: boolean;
}

export interface HubPullResult {
  skillId: string;
  path: string;
  contentHash: string;
  kind: SkillHubKind;
  source: string;
}

interface GitHubSkillSource {
  owner: string;
  repo: string;
  cloneUrl: string;
  sourceLabel: string;
  ref?: string;
  subpath?: string;
  treePathParts?: string[];
}

class GitHubArchiveDownloadError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GitHubArchiveDownloadError';
  }
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'xopc-skill-installer',
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

function normalizeSourceSubpath(subpath?: string): string | undefined {
  const raw = subpath?.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!raw || raw === '.') return undefined;
  if (/^[a-zA-Z]:/.test(raw)) {
    throw new Error(`Invalid source path: ${subpath}`);
  }
  const normalized = normalize(raw);
  if (normalized === '..' || normalized.startsWith(`..${sep}`) || resolve('/', normalized) === resolve('/')) {
    throw new Error(`Invalid source path: ${subpath}`);
  }
  return normalized.replace(/\\/g, '/');
}

function decodeUrlPathPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseSshGitHubSource(
  raw: string,
  optionRef?: string,
  optionSubpath?: string,
): GitHubSkillSource | undefined {
  const ssh = raw.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (!ssh) return undefined;
  const owner = ssh[1];
  const repo = ssh[2].replace(/\.git$/i, '');
  return {
    owner,
    repo,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
    sourceLabel: raw,
    ref: optionRef,
    subpath: optionSubpath,
  };
}

export function parseGitHubSkillSource(
  raw: string,
  options: Pick<HubPullOptions, 'ref' | 'subpath'> = {},
): GitHubSkillSource | undefined {
  const optionRef = options.ref?.trim() || undefined;
  const optionSubpath = normalizeSourceSubpath(options.subpath);
  const sshSource = parseSshGitHubSource(raw, optionRef, optionSubpath);
  if (sshSource) return sshSource;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (url.hostname.toLowerCase() !== 'github.com') return undefined;

  const parts = url.pathname.split('/').filter(Boolean).map(decodeUrlPathPart);
  if (parts.length < 2) return undefined;

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!owner || !repo) return undefined;

    let ref: string | undefined;
    let subpath: string | undefined;
    let treePathParts: string[] | undefined;
    const marker = parts[2]?.toLowerCase();
    if ((marker === 'tree' || marker === 'blob') && parts[3]) {
      treePathParts = parts.slice(3);
      ref = treePathParts[0];
      subpath = normalizeSourceSubpath(treePathParts.slice(1).join('/'));
  } else if (parts.length > 2 && !parts[1].toLowerCase().endsWith('.git')) {
    subpath = normalizeSourceSubpath(parts.slice(2).join('/'));
  }

  return {
    owner,
    repo,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
    sourceLabel: raw,
    ref: optionRef || ref,
    subpath: optionSubpath || subpath,
    treePathParts,
  };
}

export function classifyHubSource(raw: string): 'git' | 'archive' {
  const s = raw.trim();
  const lower = s.toLowerCase();

  try {
    if (s.startsWith('file:')) {
      const p = fileURLToPath(s);
      const pl = p.toLowerCase();
      if (pl.endsWith('.zip')) return 'archive';
      if (pl.endsWith('.tar.gz') || pl.endsWith('.tgz')) return 'archive';
      return 'git';
    }
  } catch {
    // ignore invalid file URL
  }

  if (/^[a-zA-Z]:[\\/]/.test(s) || (s.startsWith('/') && !s.startsWith('//'))) {
    if (lower.endsWith('.zip')) return 'archive';
    if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'archive';
    return 'git';
  }

  try {
    const u = new URL(s);
    const path = u.pathname.toLowerCase();
    if (path.endsWith('.zip')) return 'archive';
    if (path.endsWith('.tar.gz') || path.endsWith('.tgz')) return 'archive';
  } catch {
    // not a URL
  }

  if (lower.endsWith('.zip')) return 'archive';
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'archive';
  return 'git';
}

export function findSkillRoot(repoRoot: string, subpath?: string): string {
  const sub = normalizeSourceSubpath(subpath) || '';
  const root = resolve(repoRoot);
  const base = sub ? resolve(root, sub) : root;
  if (base !== root && !base.startsWith(root + sep)) {
    throw new Error(`Invalid source path: ${subpath}`);
  }
  if (!existsSync(base)) {
    throw new Error(`Path not found in source: ${sub || '.'}`);
  }
  if (existsSync(join(base, 'SKILL.md'))) {
    return base;
  }
  const entries = readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (entries.length === 1) {
    const one = join(base, entries[0].name);
    if (existsSync(join(one, 'SKILL.md'))) {
      return one;
    }
  }
  throw new Error(
    'Could not locate SKILL.md (expected at root, under --path, or in a single child folder)',
  );
}

function inferSkillIdFromSkillMd(skillRoot: string): string {
  const raw = readFileSync(join(skillRoot, 'SKILL.md'), 'utf-8');
  const { frontmatter } = parseFrontmatter(raw);
  const n = String(frontmatter.name || '').trim();
  if (n && isValidSkillId(n)) {
    return n;
  }
  const dirName = basename(skillRoot);
  if (isValidSkillId(dirName)) {
    return dirName;
  }
  return '';
}

async function runScan(dir: string, strict: boolean | undefined): Promise<void> {
  const summary = await scanSkillDirectory(dir);
  const label = basename(dir);
  if (summary.critical > 0 && strict) {
    throw new Error(
      `Security scan reported ${summary.critical} critical finding(s). ${formatScanSummary(summary, label)}`,
    );
  }
  if (summary.critical > 0 || summary.warn > 0) {
    console.warn(formatScanSummary(summary, label));
  }
}

async function copySkillTreeToManaged(
  skillRoot: string,
  ctx: HubPullOptions & { kind: SkillHubKind; source: string },
): Promise<HubPullResult> {
  const targetId = ctx.skillId?.trim() || inferSkillIdFromSkillMd(skillRoot);
  if (!targetId) {
    throw new Error('Could not determine skill id: pass --id <name> (must match managed id rules)');
  }
  if (!isValidSkillId(targetId)) {
    throw new Error(`Invalid skill id "${targetId}" (letters, digits, ._-; max 63 chars after first)`);
  }

  const { destDir, tempDir } = prepareManagedSkillTempDir(targetId, ctx.installRoot);
  try {
    if (existsSync(destDir) && !ctx.force) {
      throw new Error(`Skill "${targetId}" already exists. Use --force to replace.`);
    }

    cpSync(skillRoot, tempDir, { recursive: true });

    if (!existsSync(join(tempDir, 'SKILL.md'))) {
      throw new Error('Installed tree is missing SKILL.md');
    }

    await runScan(tempDir, ctx.strictScan);
    const promoted = promoteManagedSkillTempDir({
      skillId: targetId,
      tempDir,
      overwrite: ctx.force,
      rootDir: ctx.installRoot,
    });
    const hash = computeSkillTreeHashSync(promoted.path);
    recordSkillsHubInstall(
      targetId,
      {
        kind: ctx.kind,
        source: ctx.source,
        ref: ctx.kind === 'git' ? ctx.ref : undefined,
        subpath: ctx.kind === 'git' ? ctx.subpath : undefined,
      },
      hash,
      ctx.lockPath,
    );

    return {
      skillId: targetId,
      path: promoted.path,
      contentHash: hash,
      kind: ctx.kind,
      source: ctx.source,
    };
  } catch (err) {
    rmSync(tempDir, { recursive: true, force: true });
    throw err;
  }
}

async function pullSkillFromZipBuffer(
  buf: Buffer,
  sourceLabel: string,
  options: HubPullOptions,
): Promise<HubPullResult> {
  const r = installSkillFromZip(buf, {
    skillId: options.skillId,
    overwrite: options.force ?? false,
    rootDir: options.installRoot,
  });
  const hash = computeSkillTreeHashSync(r.path);
  recordSkillsHubInstall(r.skillId, { kind: 'archive', source: sourceLabel }, hash, options.lockPath);
  await runScan(r.path, options.strictScan);
  return {
    skillId: r.skillId,
    path: r.path,
    contentHash: hash,
    kind: 'archive',
    source: sourceLabel,
  };
}

async function pullSkillFromTarFile(
  archivePath: string,
  sourceLabel: string,
  options: HubPullOptions,
): Promise<HubPullResult> {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'xopc-tar-'));
  try {
    execFileSync('tar', ['-xzf', archivePath, '-C', tmpRoot], {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    const skillRoot = findSkillRoot(tmpRoot);
    return await copySkillTreeToManaged(skillRoot, { ...options, kind: 'archive', source: sourceLabel });
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function isSafeArchivePath(name: string): boolean {
  if (!name) return false;
  const normalized = name.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return false;
  return normalized.split('/').every((part) => part && part !== '..');
}

function extractZipBufferToTempDir(buf: Buffer, tmpRoot: string): void {
  const zip = new AdmZip(buf);
  const rootResolved = resolve(tmpRoot);
  for (const entry of zip.getEntries()) {
    const normalized = entry.entryName.replace(/\\/g, '/');
    if (!normalized || isIgnorableZipEntry(normalized)) continue;
    if (!isSafeArchivePath(normalized)) {
      throw new Error(`Unsafe zip entry path: ${entry.entryName}`);
    }

    const target = join(tmpRoot, normalized);
    const targetResolved = resolve(target);
    if (targetResolved !== rootResolved && !targetResolved.startsWith(rootResolved + sep)) {
      throw new Error(`Unsafe zip entry path: ${entry.entryName}`);
    }

    if (entry.isDirectory) {
      mkdirSync(target, { recursive: true });
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.getData());
  }
}

function findExtractedRepositoryRoot(tmpRoot: string): string {
  const entries = readdirSync(tmpRoot, { withFileTypes: true }).filter((entry) => !entry.name.startsWith('.'));
  const dirs = entries.filter((entry) => entry.isDirectory());
  const files = entries.filter((entry) => entry.isFile());
  if (dirs.length === 1 && files.length === 0) {
    return join(tmpRoot, dirs[0].name);
  }
  return tmpRoot;
}

async function resolveGitHubDefaultBranch(source: GitHubSkillSource): Promise<string | undefined> {
  const apiUrl = `https://api.github.com/repos/${source.owner}/${source.repo}`;
  try {
    const res = await fetch(apiUrl, { headers: githubHeaders() });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { default_branch?: unknown };
    const branch = typeof body.default_branch === 'string' ? body.default_branch.trim() : '';
    return branch || undefined;
  } catch {
    return undefined;
  }
}

async function githubRefExists(
  source: GitHubSkillSource,
  namespace: 'heads' | 'tags',
  ref: string,
): Promise<boolean> {
  const url = `https://api.github.com/repos/${source.owner}/${source.repo}/git/ref/${namespace}/${encodeURI(ref)}`;
  try {
    const res = await fetch(url, { headers: githubHeaders() });
    return res.ok;
  } catch {
    return false;
  }
}

async function resolveGitHubTreeRefAndSubpath(
  source: GitHubSkillSource,
  options: HubPullOptions,
): Promise<{ ref?: string; subpath?: string }> {
  const optionRef = options.ref?.trim() || undefined;
  const optionSubpath = options.subpath || undefined;
  if (optionRef || !source.treePathParts?.length) {
    return {
      ref: optionRef || source.ref,
      subpath: optionSubpath || source.subpath,
    };
  }

  for (let i = source.treePathParts.length; i >= 1; i -= 1) {
    const candidate = source.treePathParts.slice(0, i).join('/');
    if (
      (await githubRefExists(source, 'heads', candidate)) ||
      (await githubRefExists(source, 'tags', candidate))
    ) {
      return {
        ref: candidate,
        subpath: optionSubpath || normalizeSourceSubpath(source.treePathParts.slice(i).join('/')),
      };
    }
  }

  return {
    ref: source.ref,
    subpath: optionSubpath || source.subpath,
  };
}

async function pullSkillFromGitHubArchive(
  source: GitHubSkillSource,
  options: HubPullOptions,
): Promise<HubPullResult> {
  const ref = options.ref?.trim() || (await resolveGitHubDefaultBranch(source)) || 'main';
  const zipUrl = `https://codeload.github.com/${source.owner}/${source.repo}/zip/${encodeURI(ref)}`;
  const res = await fetch(zipUrl, { headers: githubHeaders() });
  if (!res.ok) {
    throw new GitHubArchiveDownloadError(`HTTP ${res.status} while fetching GitHub archive`, res.status);
  }

  const tmpRoot = mkdtempSync(join(tmpdir(), 'xopc-github-zip-'));
  try {
    const buf = Buffer.from(await res.arrayBuffer());
    extractZipBufferToTempDir(buf, tmpRoot);
    const repoRoot = findExtractedRepositoryRoot(tmpRoot);
    const effectiveOptions = { ...options, ref, subpath: options.subpath || source.subpath };
    const skillRoot = findSkillRoot(repoRoot, effectiveOptions.subpath);
    return await copySkillTreeToManaged(skillRoot, {
      ...effectiveOptions,
      kind: 'git',
      source: source.sourceLabel,
    });
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

async function pullSkillFromGitHubSparse(
  source: GitHubSkillSource,
  options: HubPullOptions,
): Promise<HubPullResult> {
  const subpath = normalizeSourceSubpath(options.subpath || source.subpath);
  if (!subpath) {
    return pullSkillFromGit(source.cloneUrl, options, source.sourceLabel);
  }

  const tmpRoot = mkdtempSync(join(tmpdir(), 'xopc-github-sparse-'));
  const cloneDir = join(tmpRoot, 'clone');
  let clonedRef = options.ref?.trim() || undefined;
  try {
    const args = ['clone', '--depth', '1', '--filter=blob:none', '--sparse'];
    if (clonedRef) {
      args.push('--branch', clonedRef);
    }
    args.push(source.cloneUrl, cloneDir);
    try {
      execFileSync('git', args, { stdio: 'pipe', encoding: 'utf-8' });
    } catch {
      if (!clonedRef) throw new Error(`git clone failed for ${source.cloneUrl}`);
      clonedRef = undefined;
      execFileSync(
        'git',
        ['clone', '--depth', '1', '--filter=blob:none', '--sparse', source.cloneUrl, cloneDir],
        { stdio: 'pipe', encoding: 'utf-8' },
      );
    }

    execFileSync('git', ['-C', cloneDir, 'sparse-checkout', 'set', '--no-cone', subpath], {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    const effectiveOptions = { ...options, subpath, ref: clonedRef };
    const skillRoot = findSkillRoot(cloneDir, subpath);
    return await copySkillTreeToManaged(skillRoot, {
      ...effectiveOptions,
      kind: 'git',
      source: source.sourceLabel,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('ENOENT') || msg.includes('git clone failed')) {
      throw new Error(
        `Git operation failed (${msg}). Ensure git is installed and the repository URL is valid.`,
      );
    }
    throw e;
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

async function pullSkillFromGitHub(
  source: GitHubSkillSource,
  options: HubPullOptions,
): Promise<HubPullResult> {
  const resolved = await resolveGitHubTreeRefAndSubpath(source, options);
  const effectiveOptions = {
    ...options,
    ref: resolved.ref,
    subpath: resolved.subpath,
  };
  try {
    return await pullSkillFromGitHubArchive(source, effectiveOptions);
  } catch (archiveErr) {
    try {
      return await pullSkillFromGitHubSparse(source, effectiveOptions);
    } catch (gitErr) {
      const archiveMsg = archiveErr instanceof Error ? archiveErr.message : String(archiveErr);
      const gitMsg = gitErr instanceof Error ? gitErr.message : String(gitErr);
      throw new Error(`GitHub archive install failed (${archiveMsg}); git fallback failed (${gitMsg})`);
    }
  }
}

async function pullSkillFromLocalPath(absPath: string, options: HubPullOptions): Promise<HubPullResult> {
  const resolved = resolve(absPath);
  if (!existsSync(resolved)) {
    throw new Error(`Not found: ${resolved}`);
  }
  const st = statSync(resolved);
  if (!st.isFile()) {
    throw new Error('Expected a path to a .zip or .tar.gz file (directories are not supported here)');
  }
  const lower = resolved.toLowerCase();
  if (lower.endsWith('.zip')) {
    const buf = readFileSync(resolved);
    return pullSkillFromZipBuffer(buf, resolved, options);
  }
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    return pullSkillFromTarFile(resolved, resolved, options);
  }
  throw new Error('Unsupported file type (expected .zip, .tar.gz, or .tgz)');
}

async function pullSkillFromGit(
  url: string,
  options: HubPullOptions,
  sourceLabel = url,
): Promise<HubPullResult> {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'xopc-hub-'));
  const cloneDir = join(tmpRoot, 'clone');
  let clonedRef = options.ref?.trim() || undefined;
  try {
    const args = ['clone', '--depth', '1'];
    if (clonedRef) {
      args.push('--branch', clonedRef);
    }
    args.push(url, cloneDir);
    try {
      execFileSync('git', args, { stdio: 'pipe', encoding: 'utf-8' });
    } catch {
      if (clonedRef) {
        clonedRef = undefined;
        execFileSync('git', ['clone', '--depth', '1', url, cloneDir], {
          stdio: 'pipe',
          encoding: 'utf-8',
        });
      } else {
        throw new Error(`git clone failed for ${url}`);
      }
    }
    const skillRoot = findSkillRoot(cloneDir, options.subpath);
    return await copySkillTreeToManaged(skillRoot, {
      ...options,
      ref: clonedRef,
      kind: 'git',
      source: sourceLabel,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('ENOENT') || msg.includes('git clone failed')) {
      throw new Error(
        `Git operation failed (${msg}). Ensure git is installed and the repository URL is valid.`,
      );
    }
    throw e;
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

/**
 * Install or replace a skill from a git URL, http(s) archive URL, file:// URL, or local archive path.
 */
export async function pullSkillFromSource(
  source: string,
  options: HubPullOptions = {},
): Promise<HubPullResult> {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new Error('Missing source URL or path');
  }

  if (trimmed.startsWith('file:')) {
    return pullSkillFromLocalPath(fileURLToPath(trimmed), options);
  }

  if (!/^[a-zA-Z][a-zA-Z+.-]*:\/\//.test(trimmed) && existsSync(trimmed)) {
    return pullSkillFromLocalPath(resolve(trimmed), options);
  }

  const githubSource = parseGitHubSkillSource(trimmed, options);
  if (githubSource) {
    return pullSkillFromGitHub(githubSource, options);
  }

  const kind = classifyHubSource(trimmed);
  if (kind === 'archive') {
    const res = await fetch(trimmed);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} while fetching archive`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const lower = trimmed.toLowerCase();
    if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
      const tmpRoot = mkdtempSync(join(tmpdir(), 'xopc-fetch-tar-'));
      const f = join(tmpRoot, 'archive.tgz');
      try {
        mkdirSync(tmpRoot, { recursive: true });
        writeFileSync(f, buf);
        return await pullSkillFromTarFile(f, trimmed, options);
      } finally {
        rmSync(tmpRoot, { recursive: true, force: true });
      }
    }
    return pullSkillFromZipBuffer(buf, trimmed, options);
  }

  return pullSkillFromGit(trimmed, options);
}

/** Re-install from the source recorded in ~/.xopc/skills-lock.json for this skill id. */
export async function updateSkillFromLock(
  skillId: string,
  options: Pick<HubPullOptions, 'strictScan'> = {},
): Promise<HubPullResult> {
  const e = getSkillsLockEntry(skillId);
  if (!e) {
    throw new Error(
      `No hub lock entry for "${skillId}". Install with: xopc skills pull <git-or-archive-url>`,
    );
  }
  return pullSkillFromSource(e.source, {
    skillId,
    ref: e.ref,
    subpath: e.subpath,
    force: true,
    strictScan: options.strictScan,
  });
}

/**
 * CLI / hub: install or update skills from git or archive (zip / tar.gz) into ~/.xopc/skills.
 */

import { execFileSync } from 'node:child_process';
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
import { basename, join, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { fetch } from 'undici';

import { parseFrontmatter } from '../../markdown/frontmatter.js';
import { computeSkillTreeHashSync } from './hub-hash.js';
import { getSkillsLockEntry, recordSkillsHubInstall } from './hub-lock.js';
import type { SkillHubKind } from './hub-lock.js';
import {
  installSkillFromZip,
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
  const sub = subpath?.trim()
    ? normalize(subpath.trim()).replace(/^[/\\]+/, '')
    : '';
  const base = sub ? resolve(repoRoot, sub) : resolve(repoRoot);
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

  const { destDir, tempDir } = prepareManagedSkillTempDir(targetId);
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
  });
  const hash = computeSkillTreeHashSync(r.path);
  recordSkillsHubInstall(r.skillId, { kind: 'archive', source: sourceLabel }, hash);
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

async function pullSkillFromGit(url: string, options: HubPullOptions): Promise<HubPullResult> {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'xopc-hub-'));
  const cloneDir = join(tmpRoot, 'clone');
  try {
    const args = ['clone', '--depth', '1'];
    if (options.ref?.trim()) {
      args.push('--branch', options.ref.trim());
    }
    args.push(url, cloneDir);
    try {
      execFileSync('git', args, { stdio: 'pipe', encoding: 'utf-8' });
    } catch {
      if (options.ref?.trim()) {
        execFileSync('git', ['clone', '--depth', '1', url, cloneDir], {
          stdio: 'pipe',
          encoding: 'utf-8',
        });
      } else {
        throw new Error(`git clone failed for ${url}`);
      }
    }
    const skillRoot = findSkillRoot(cloneDir, options.subpath);
    return await copySkillTreeToManaged(skillRoot, { ...options, kind: 'git', source: url });
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

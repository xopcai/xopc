/**
 * Smart-share decision layer.
 *
 * The mobile app calls POST /api/shares/auto with a path + audience and
 * lets the server pick file-share vs site-share, pick sane TTLs, and bundle
 * the metadata the share-sheet needs (title, description, thumbnail URL,
 * reachability).
 */
import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { basename, join, resolve as resolvePath } from 'node:path';
import { readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { resolveMimeType } from './share-store.js';

export type ShareAudience = 'friend' | 'colleague' | 'public';

export type ShareAutoMode = 'auto' | 'force-file' | 'force-site' | 'force-zip';

export type ShareAutoKind = 'file' | 'site' | 'zip';

export interface ShareAutoDecision {
  kind: ShareAutoKind;
  isDirectory: boolean;
  reason:
    | 'html-single-file'
    | 'html-with-assets'
    | 'small-image'
    | 'large-binary'
    | 'directory-zip'
    | 'directory-browse'
    | 'forced';
  hint: string;
}

export interface ShareAutoProbe {
  absolutePath: string;
  kind: 'file' | 'directory';
  size: number;
  mimeType: string;
  hasIndexHtml: boolean;
}

export interface ShareAutoDefaults {
  ttlMs: number;
  maxViews: number | null;
}

/** Convert an audience hint into TTL/maxViews defaults. */
export function audienceDefaults(audience: ShareAudience | undefined): ShareAutoDefaults {
  switch (audience) {
    case 'public':
      return { ttlMs: 24 * 60 * 60_000, maxViews: 100 };
    case 'colleague':
      return { ttlMs: 7 * 24 * 60 * 60_000, maxViews: null };
    case 'friend':
    default:
      return { ttlMs: 3 * 24 * 60 * 60_000, maxViews: null };
  }
}

/** Run filesystem probes needed by the routing logic. */
export async function probeShareTarget(
  workspaceRoot: string,
  relPath: string,
): Promise<ShareAutoProbe> {
  const trimmed = relPath.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!trimmed) throw new Error('Empty path');
  if (trimmed.includes('..') || trimmed.includes('\0')) throw new Error('Invalid path');
  const abs = resolvePath(workspaceRoot, trimmed);
  const st = await stat(abs);
  if (st.isDirectory()) {
    let hasIndexHtml = false;
    try {
      const entries = readdirSync(abs);
      hasIndexHtml = entries.includes('index.html');
    } catch {
      /* unreadable dir is handled later */
    }
    return {
      absolutePath: abs,
      kind: 'directory',
      size: 0,
      mimeType: 'application/x-directory',
      hasIndexHtml,
    };
  }
  if (!st.isFile()) throw new Error('Path is not a regular file or directory');
  const fileName = basename(abs);
  return {
    absolutePath: abs,
    kind: 'file',
    size: st.size,
    mimeType: resolveMimeType(fileName),
    hasIndexHtml: false,
  };
}

/** Pure decision function — exported for tests. */
export function decideShareKind(probe: ShareAutoProbe, mode: ShareAutoMode | undefined): ShareAutoDecision {
  if (mode === 'force-file') {
    return forced(probe.kind === 'directory' ? 'zip' : 'file', probe);
  }
  if (mode === 'force-site') {
    if (probe.kind !== 'directory' && probe.mimeType !== 'text/html') {
      throw new Error('force-site requires a directory or a single HTML file');
    }
    return { kind: 'site', isDirectory: probe.kind === 'directory', reason: 'forced', hint: '已按指定方式作为站点分享' };
  }
  if (mode === 'force-zip') {
    if (probe.kind !== 'directory') throw new Error('force-zip requires a directory');
    return { kind: 'zip', isDirectory: true, reason: 'forced', hint: '已按指定方式打包为 ZIP 分享' };
  }

  // mode === undefined or 'auto'
  if (probe.kind === 'directory') {
    if (probe.hasIndexHtml) {
      return {
        kind: 'site',
        isDirectory: true,
        reason: 'html-with-assets',
        hint: '目录包含 index.html，已通过站点分享渲染',
      };
    }
    return {
      kind: 'file',
      isDirectory: true,
      reason: 'directory-browse',
      hint: '目录较多文件，通过分享页可浏览或下载 ZIP',
    };
  }

  if (probe.mimeType === 'text/html') {
    return {
      kind: 'site',
      isDirectory: false,
      reason: 'html-single-file',
      hint: 'HTML 文件，分享后朋友点开即渲染',
    };
  }

  if (probe.mimeType.startsWith('image/') && probe.size < 10 * 1024 * 1024) {
    return {
      kind: 'file',
      isDirectory: false,
      reason: 'small-image',
      hint: '图片文件，朋友可直接预览或保存',
    };
  }

  return {
    kind: 'file',
    isDirectory: false,
    reason: 'large-binary',
    hint: '通过分享链接由朋友点开下载',
  };
}

function forced(kind: ShareAutoKind, probe: ShareAutoProbe): ShareAutoDecision {
  return {
    kind,
    isDirectory: probe.kind === 'directory',
    reason: 'forced',
    hint: '按指定方式分享',
  };
}

/** Build the user-facing title (trimmed, no extension). */
export function makeTitle(fileName: string, override?: string): string {
  if (override && override.trim()) return clip(override.trim(), 60);
  const idx = fileName.lastIndexOf('.');
  const base = idx > 0 ? fileName.slice(0, idx) : fileName;
  return clip(base || fileName, 60);
}

/** Build the user-facing description (audience + TTL hint baked in). */
export function makeDescription(opts: {
  audience: ShareAudience | undefined;
  expiresAt: string;
  override?: string;
}): string {
  if (opts.override && opts.override.trim()) return clip(opts.override.trim(), 140);
  const now = Date.now();
  const exp = new Date(opts.expiresAt).getTime();
  const days = Math.max(1, Math.round((exp - now) / (24 * 60 * 60_000)));
  const audienceHint =
    opts.audience === 'public' ? '公开分享' :
    opts.audience === 'colleague' ? '同事可见' : '好友可见';
  return clip(`由 xopc 生成 · ${audienceHint} · ${days} 天内有效`, 140);
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/** Subfolder under the workspace where single-HTML site shares are staged. */
export const STAGING_DIR_NAME = '.xopc-share-staging';

export interface StagedSite {
  /** Absolute path of the freshly-created staging directory. */
  stagingDir: string;
  /** Workspace-relative path to feed into SiteShareStore.create({ path }). */
  relativePath: string;
}

/**
 * Copy a single HTML file into `<workspaceRoot>/.xopc-share-staging/<uuid>/index.html`
 * so it can be served as a site (SiteShareStore needs a directory root).
 *
 * The caller must register a cleanup that calls `cleanupStagedSite(stagingDir)`
 * when the underlying site share is revoked / expires.
 */
export async function stageSingleHtmlAsSite(
  workspaceRoot: string,
  absoluteHtmlPath: string,
): Promise<StagedSite> {
  const stagingRoot = resolvePath(workspaceRoot, STAGING_DIR_NAME);
  await mkdir(stagingRoot, { recursive: true });
  const id = randomUUID();
  const stagingDir = join(stagingRoot, id);
  await mkdir(stagingDir, { recursive: true });
  const target = join(stagingDir, 'index.html');
  await copyFile(absoluteHtmlPath, target);
  // Workspace-relative POSIX form expected by SiteShareStore.
  const rel = `${STAGING_DIR_NAME}/${id}`;
  return { stagingDir, relativePath: rel };
}

/** Best-effort cleanup; never throws. */
export async function cleanupStagedSite(stagingDir: string): Promise<void> {
  // Defensive: only remove if it's inside our staging folder name.
  if (!stagingDir.includes(STAGING_DIR_NAME)) return;
  try {
    await rm(stagingDir, { recursive: true, force: true });
  } catch {
    /* ignore — disk may already be gone */
  }
}

// ── Site staging registry (in-process) ────────────────────────────────────────
//
// Maps a site-share record id → absolute staging directory created for it.
// Used by the SiteShareStore cleanup hook to delete the directory when the
// share is revoked / expires. Restart-safe in the trivial sense: if the
// process dies before cleanup fires, the directory just lingers on disk;
// it is bounded (one folder per stale share) and gets swept by
// `sweepOrphanedStagingDirs` at startup.

const stagedSiteByRecordId = new Map<string, string>();

export function rememberStagedSite(recordId: string, stagingDir: string): void {
  stagedSiteByRecordId.set(recordId, stagingDir);
}

export function forgetStagedSite(recordId: string): string | undefined {
  const dir = stagedSiteByRecordId.get(recordId);
  stagedSiteByRecordId.delete(recordId);
  return dir;
}

/**
 * Walk `<workspaceRoot>/.xopc-share-staging/` and drop directories that are
 * no longer referenced by any live site-share record. Call at gateway boot.
 */
export async function sweepOrphanedStagingDirs(
  workspaceRoot: string,
  liveStagingDirs: Set<string>,
): Promise<void> {
  const stagingRoot = resolvePath(workspaceRoot, STAGING_DIR_NAME);
  let entries: string[];
  try {
    entries = readdirSync(stagingRoot);
  } catch {
    return; // dir doesn't exist; nothing to sweep
  }
  for (const name of entries) {
    const abs = join(stagingRoot, name);
    if (liveStagingDirs.has(abs)) continue;
    try {
      await rm(abs, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Boot-time housekeeping:
 *  1. Walk active static site shares whose source lives under STAGING_DIR_NAME
 *     (i.e. created via `stageSingleHtmlAsSite`).
 *  2. Re-register them in the in-process registry so the SiteShareStore
 *     cleanup hook still wipes the right directory on revoke/expire after a
 *     restart.
 *  3. Sweep each workspace's `.xopc-share-staging/` for entries that are not
 *     referenced by any live record — these are leftovers from a previous
 *     process death between create-staging and persist.
 *
 * Safe to call multiple times; idempotent. Best invoked from gateway.start().
 */
export async function runStagingSweep(): Promise<void> {
  // Lazy import to keep this module dependency-light for tests that only
  // exercise the pure decision helpers above.
  const { getSiteShareStore } = await import('./site-share-store.js');
  const store = getSiteShareStore();
  const records = store.getActiveShares();

  const liveByWorkspace = new Map<string, Set<string>>();
  for (const rec of records) {
    if (rec.source.kind !== 'static') continue;
    const ws = rec.source.workspaceRoot;
    const rootDir = rec.source.rootDir;
    if (!ws || !rootDir) continue;
    if (!rec.source.workspaceRelativePath.startsWith(`${STAGING_DIR_NAME}/`)) continue;
    rememberStagedSite(rec.id, rootDir);
    const bucket = liveByWorkspace.get(ws) ?? new Set<string>();
    bucket.add(rootDir);
    liveByWorkspace.set(ws, bucket);
  }

  // Workspaces with NO live staged shares still need a sweep: a record may
  // have expired (so getActiveShares filters it out) without its staging dir
  // being deleted. We collect those workspaces too.
  for (const rec of store.getAllShares()) {
    if (rec.source.kind !== 'static') continue;
    if (!rec.source.workspaceRelativePath.startsWith(`${STAGING_DIR_NAME}/`)) continue;
    if (!liveByWorkspace.has(rec.source.workspaceRoot)) {
      liveByWorkspace.set(rec.source.workspaceRoot, new Set());
    }
  }

  for (const [workspaceRoot, live] of liveByWorkspace) {
    await sweepOrphanedStagingDirs(workspaceRoot, live);
  }
}

export function resetStagedSiteRegistryForTests(): void {
  stagedSiteByRecordId.clear();
}

/**
 * Catalog for named workflows.
 *
 * Resolution order (built-ins are starting points, user workflows win):
 *   1. `~/.xopc/workflows/<name>/workflow.js` (+ optional `manifest.json`)
 *   2. `~/.xopc/workflows/<name>.js` (or `<name>.workflow.js`)
 *   3. {@link BUILTIN_WORKFLOWS}
 *
 * The user dir is discovered via {@link resolveStateDir}, so `XOPC_STATE_DIR`
 * overrides apply automatically (matches how skills / extensions are wired).
 *
 * Listing is filesystem-cheap (single `readdir`) and runs synchronously — the
 * `/workflows` slash command is interactive and should return immediately.
 *
 * Validation: on load we re-parse the script to make sure `meta.name` matches
 * the filename. This prevents copy-pasted scripts from being silently
 * mis-addressed when invoked by name.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import type { WorkflowDefinitionManifest } from '../../workflows/domain/definition.js';

import { resolveStateDir } from '../../config/paths-state.js';

import { BUILTIN_WORKFLOWS } from './builtins/index.js';
import { parseWorkflowScript } from './parser.js';
import type { WorkflowMeta } from './types.js';

export type WorkflowSource = 'user' | 'builtin';

export interface CatalogEntry {
  name: string;
  source: WorkflowSource;
  /** Absolute path for user entries; null for built-ins (in-memory). */
  path: string | null;
  description: string;
  title?: string;
  version?: string;
  whenToUse?: string;
  tags?: string[];
  estimatedAgents?: { min: number; max: number };
}

export interface LoadedWorkflow {
  name: string;
  source: WorkflowSource;
  script: string;
  meta: WorkflowMeta;
  path: string | null;
  manifest?: WorkflowDefinitionManifest;
}

export interface WorkflowCatalog {
  list(): CatalogEntry[];
  /** Load a named workflow. Throws if missing or meta.name disagrees with filename. */
  load(name: string): LoadedWorkflow;
  /** Save a script as a user workflow. Throws if the script fails to parse. */
  save(name: string, script: string): { path: string };
  /** Remove a user workflow. No-op if absent. Built-ins are never removed. */
  remove(name: string): boolean;
  /** Absolute path to the user workflows directory (created lazily on save). */
  userDir: string;
}

const NAME_RE = /^[a-z][a-z0-9_-]*$/;

export function createWorkflowCatalog(opts: { userDir?: string } = {}): WorkflowCatalog {
  const userDir = opts.userDir ?? defaultUserDir();

  const list = (): CatalogEntry[] => {
    const entries = new Map<string, CatalogEntry>();
    for (const b of BUILTIN_WORKFLOWS) {
      const meta = safeMeta(b.script);
      entries.set(b.name, {
        name: b.name,
        source: 'builtin',
        path: null,
        description: meta?.description ?? '(unparseable)',
        whenToUse: meta?.whenToUse,
        tags: meta?.tags,
        estimatedAgents: meta?.estimatedAgents,
      });
    }
    for (const entry of safeListUserEntries(userDir)) {
      const meta = safeMeta(readScript(entry.path));
      const manifest = readManifest(entry.manifestPath);
      // User wins on collision.
      entries.set(entry.name, {
        name: entry.name,
        source: 'user',
        path: entry.path,
        description: manifest?.description ?? meta?.description ?? '(unparseable)',
        title: manifest?.title,
        version: manifest?.version,
        whenToUse: manifest?.whenToUse ?? meta?.whenToUse,
        tags: manifest?.tags ?? meta?.tags,
        estimatedAgents: meta?.estimatedAgents,
      });
    }
    return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
  };

  const load = (name: string): LoadedWorkflow => {
    requireValidName(name);
    const userEntry = findUserEntry(userDir, name);
    if (userEntry) {
      const script = readScript(userEntry.path);
      const { meta } = parseWorkflowScript(script);
      ensureMetaNameMatches(meta, name, userEntry.path);
      return {
        name,
        source: 'user',
        script,
        meta,
        path: userEntry.path,
        manifest: readManifest(userEntry.manifestPath),
      };
    }
    const builtin = BUILTIN_WORKFLOWS.find((b) => b.name === name);
    if (builtin) {
      const { meta } = parseWorkflowScript(builtin.script);
      ensureMetaNameMatches(meta, name, '<builtin>');
      return { name, source: 'builtin', script: builtin.script, meta, path: null };
    }
    throw new Error(
      `workflow not found: ${name}. Drop a script at ${join(userDir, `${name}.js`)} or pick one of: ${list()
        .map((e) => e.name)
        .join(', ')}`,
    );
  };

  const save = (name: string, script: string): { path: string } => {
    requireValidName(name);
    const { meta } = parseWorkflowScript(script);
    if (meta.name !== name) {
      throw new Error(
        `meta.name "${meta.name}" does not match save name "${name}". Adjust one to match the other.`,
      );
    }
    if (!existsSync(userDir)) {
      mkdirSync(userDir, { recursive: true });
    }
    const path = join(userDir, `${name}.js`);
    writeFileSync(path, normalizeNewlines(script), 'utf-8');
    return { path };
  };

  const remove = (name: string): boolean => {
    requireValidName(name);
    const userEntry = findUserEntry(userDir, name);
    if (!userEntry) return false;
    unlinkSync(userEntry.path);
    return true;
  };

  return { list, load, save, remove, userDir };
}

// ---------------------------------------------------------------------------

export function defaultUserDir(): string {
  return join(resolveStateDir(), 'workflows');
}

interface UserWorkflowEntry {
  name: string;
  path: string;
  manifestPath?: string;
}

function safeListUserEntries(dir: string): UserWorkflowEntry[] {
  try {
    if (!existsSync(dir)) return [];
    const st = statSync(dir);
    if (!st.isDirectory()) return [];
    const entries: UserWorkflowEntry[] = [];
    for (const file of readdirSync(dir)) {
      const full = join(dir, file);
      const fileStat = statSync(full);
      if (fileStat.isDirectory()) {
        const workflowPath = join(full, 'workflow.js');
        if (existsSync(workflowPath) && isValidName(file)) {
          entries.push({ name: file, path: workflowPath, manifestPath: join(full, 'manifest.json') });
        }
        continue;
      }
      if (!/\.(js|workflow\.js)$/i.test(file)) continue;
      const name = stripExt(file);
      if (!isValidName(name)) continue;
      entries.push({ name, path: full });
    }
    return entries;
  } catch {
    return [];
  }
}

function findUserEntry(dir: string, name: string): UserWorkflowEntry | null {
  const dirWorkflowPath = join(dir, name, 'workflow.js');
  if (existsSync(dirWorkflowPath)) {
    return { name, path: dirWorkflowPath, manifestPath: join(dir, name, 'manifest.json') };
  }
  for (const candidate of [`${name}.js`, `${name}.workflow.js`]) {
    const full = join(dir, candidate);
    if (existsSync(full)) return { name, path: full };
  }
  return null;
}

function readScript(path: string): string {
  return readFileSync(path, 'utf-8');
}

function readManifest(path: string | undefined): WorkflowDefinitionManifest | undefined {
  if (!path || !existsSync(path)) return undefined;
  try {
    const value = JSON.parse(readFileSync(path, 'utf-8')) as WorkflowDefinitionManifest;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function safeMeta(script: string): WorkflowMeta | null {
  try {
    return parseWorkflowScript(script).meta;
  } catch {
    return null;
  }
}

function stripExt(filename: string): string {
  return filename.replace(/\.workflow\.js$/i, '').replace(/\.js$/i, '');
}

function isValidName(name: string): boolean {
  return NAME_RE.test(name);
}

function requireValidName(name: string): void {
  if (!isValidName(name)) {
    throw new Error(`invalid workflow name "${name}". Use lowercase snake_case, e.g. "audit_repo".`);
  }
}

function ensureMetaNameMatches(meta: WorkflowMeta, name: string, locator: string): void {
  if (meta.name !== name) {
    throw new Error(
      `workflow ${locator}: meta.name "${meta.name}" disagrees with addressable name "${name}". ` +
        'Rename the file or the meta.name to match.',
    );
  }
}

function normalizeNewlines(s: string): string {
  return s.endsWith('\n') ? s : `${s}\n`;
}

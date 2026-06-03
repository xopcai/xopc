/**
 * Catalog for named workflows.
 *
 * Resolution order (built-ins are starting points, user workflows win):
 *   1. `~/.xopc/workflows/<name>.js` (or `<name>.workflow.js`)
 *   2. {@link BUILTIN_WORKFLOWS}
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
  whenToUse?: string;
}

export interface LoadedWorkflow {
  name: string;
  source: WorkflowSource;
  script: string;
  meta: WorkflowMeta;
  path: string | null;
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
      });
    }
    for (const file of safeListUserFiles(userDir)) {
      const name = stripExt(file);
      if (!isValidName(name)) continue;
      const full = join(userDir, file);
      const meta = safeMeta(readScript(full));
      // User wins on collision.
      entries.set(name, {
        name,
        source: 'user',
        path: full,
        description: meta?.description ?? '(unparseable)',
        whenToUse: meta?.whenToUse,
      });
    }
    return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
  };

  const load = (name: string): LoadedWorkflow => {
    requireValidName(name);
    const userPath = findUserPath(userDir, name);
    if (userPath) {
      const script = readScript(userPath);
      const { meta } = parseWorkflowScript(script);
      ensureMetaNameMatches(meta, name, userPath);
      return { name, source: 'user', script, meta, path: userPath };
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
    const userPath = findUserPath(userDir, name);
    if (!userPath) return false;
    unlinkSync(userPath);
    return true;
  };

  return { list, load, save, remove, userDir };
}

// ---------------------------------------------------------------------------

export function defaultUserDir(): string {
  return join(resolveStateDir(), 'workflows');
}

function safeListUserFiles(dir: string): string[] {
  try {
    if (!existsSync(dir)) return [];
    const st = statSync(dir);
    if (!st.isDirectory()) return [];
    return readdirSync(dir).filter((f) => /\.(js|workflow\.js)$/i.test(f));
  } catch {
    return [];
  }
}

function findUserPath(dir: string, name: string): string | null {
  for (const candidate of [`${name}.js`, `${name}.workflow.js`]) {
    const full = join(dir, candidate);
    if (existsSync(full)) return full;
  }
  return null;
}

function readScript(path: string): string {
  return readFileSync(path, 'utf-8');
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

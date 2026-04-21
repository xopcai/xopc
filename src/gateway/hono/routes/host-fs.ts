/**
 * Authenticated host filesystem browse API for Web UI (e.g. session working directory).
 * Lists directories the gateway process can read — intended for trusted operators only.
 */
import type { Hono } from 'hono';
import { readdir, realpath, stat } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { createLogger } from '../../../utils/logger.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const log = createLogger('HostFs');

function jsonError(status: number, message: string) {
  return Response.json({ ok: false, error: { message } }, { status });
}

function skipDotName(name: string): boolean {
  return name.startsWith('.');
}

/** Windows: true if `p` is a drive root like `C:\`. */
function isWindowsDriveRoot(p: string): boolean {
  return /^[A-Za-z]:\\?$/.test(path.normalize(p).replace(/\\$/, '\\'));
}

function parentDirectory(absNormalized: string): string | null {
  if (process.platform === 'win32') {
    const n = path.normalize(absNormalized);
    if (isWindowsDriveRoot(n)) {
      return null;
    }
    const d = path.dirname(n);
    if (d === n) return null;
    return d;
  }
  const n = path.normalize(absNormalized);
  if (n === '/' || n === path.parse(n).root) {
    return null;
  }
  const d = path.dirname(n);
  if (d === n) return null;
  return d;
}

async function listWindowsDrives(): Promise<
  { name: string; absolutePath: string; isDirectory: boolean }[]
> {
  const entries: { name: string; absolutePath: string; isDirectory: boolean }[] = [];
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    const root = `${letter}:\\`;
    try {
      await stat(root);
      entries.push({ name: root, absolutePath: root, isDirectory: true });
    } catch {
      /* not mounted */
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

export function registerHostFsRoutes(authenticated: Hono, _deps: AuthenticatedRouteDeps): void {
  authenticated.get('/api/host/fs/meta', (c) => {
    return c.json({
      ok: true,
      payload: {
        hostname: os.hostname(),
        platform: process.platform,
        pathSeparator: path.sep,
      },
    });
  });

  /**
   * GET /api/host/fs/list?path=
   * - Omit or empty `path`: root — `/` on POSIX; drive letters on Windows.
   * - Otherwise: absolute path on the gateway host (URL-encoded).
   */
  authenticated.get('/api/host/fs/list', async (c) => {
    const raw = c.req.query('path');
    const trimmed = typeof raw === 'string' ? raw.trim() : '';

    if (!trimmed) {
      if (process.platform === 'win32') {
        try {
          const entries = await listWindowsDrives();
          return c.json({
            ok: true,
            payload: {
              currentPath: '',
              parentPath: null,
              entries,
            },
          });
        } catch (err) {
          log.warn({ err }, 'host fs list drives failed');
          return jsonError(500, 'Failed to list drives');
        }
      }

      try {
        const root = await realpath('/');
        const dirents = await readdir(root, { withFileTypes: true });
        const entries: { name: string; absolutePath: string; isDirectory: boolean }[] = [];
        for (const e of dirents) {
          if (skipDotName(e.name)) continue;
          const fullPath = path.join(root, e.name);
          if (e.isDirectory()) {
            entries.push({ name: e.name, absolutePath: fullPath, isDirectory: true });
          } else {
            entries.push({ name: e.name, absolutePath: fullPath, isDirectory: false });
          }
        }
        entries.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        return c.json({
          ok: true,
          payload: {
            currentPath: root,
            parentPath: null,
            entries,
          },
        });
      } catch (err) {
        log.warn({ err }, 'host fs list root failed');
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(500, msg || 'Failed to read root');
      }
    }

    let resolved: string;
    try {
      const normalized = path.normalize(trimmed);
      resolved = await realpath(normalized);
    } catch (err) {
      log.warn({ err, path: trimmed }, 'host fs realpath failed');
      return jsonError(404, 'Path not found');
    }

    let st;
    try {
      st = await stat(resolved);
    } catch (err) {
      log.warn({ err, path: resolved }, 'host fs stat failed');
      return jsonError(404, 'Path not found');
    }

    if (!st.isDirectory()) {
      return jsonError(400, 'Not a directory');
    }

    const parentPath = parentDirectory(resolved);

    try {
      const dirents = await readdir(resolved, { withFileTypes: true });
      const entries: { name: string; absolutePath: string; isDirectory: boolean }[] = [];
      for (const e of dirents) {
        if (skipDotName(e.name)) continue;
        const fullPath = path.join(resolved, e.name);
        entries.push({
          name: e.name,
          absolutePath: fullPath,
          isDirectory: e.isDirectory(),
        });
      }
      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return c.json({
        ok: true,
        payload: {
          currentPath: resolved,
          parentPath,
          entries,
        },
      });
    } catch (err) {
      log.warn({ err, path: resolved }, 'host fs readdir failed');
      const msg = err instanceof Error ? err.message : String(err);
      if ((err as NodeJS.ErrnoException)?.code === 'EACCES') {
        return jsonError(403, 'Permission denied');
      }
      return jsonError(500, msg || 'Failed to read directory');
    }
  });
}

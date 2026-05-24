import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const REGISTRY_UNINSTALL_ROOT =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';

/** Best-effort recursive size; returns null when unreadable or over entry cap. */
export async function estimateDirSizeBytes(
  root: string,
  maxEntries = 10_000,
): Promise<number | null> {
  try {
    let total = 0;
    let entries = 0;
    const stack = [root];
    while (stack.length > 0 && entries < maxEntries) {
      const dir = stack.pop()!;
      const names = await readdir(dir, { withFileTypes: true });
      for (const ent of names) {
        if (entries >= maxEntries) {
          return null;
        }
        const full = join(dir, ent.name);
        entries++;
        if (ent.isDirectory()) {
          stack.push(full);
        } else if (ent.isFile()) {
          const st = await stat(full);
          total += st.size;
        }
      }
    }
    return total;
  } catch {
    return null;
  }
}

/** Parse `reg query` output for DisplayName / UninstallString under Uninstall keys. */
export async function queryWindowsUninstallerFromRegistry(
  productHint = 'xopc',
): Promise<string | null> {
  if (process.platform !== 'win32') {
    return null;
  }
  try {
    const { stdout } = await execFileAsync(
      'reg',
      ['query', REGISTRY_UNINSTALL_ROOT],
      { windowsHide: true, timeout: 8_000 },
    );
    const keyPaths = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('HKEY_'));
    for (const keyPath of keyPaths) {
      try {
        const { stdout: detail } = await execFileAsync(
          'reg',
          ['query', keyPath],
          { windowsHide: true, timeout: 5_000 },
        );
        const lines = detail.split(/\r?\n/).map((l) => l.trim());
        let displayName: string | null = null;
        let uninstallString: string | null = null;
        for (const line of lines) {
          if (line.startsWith('DisplayName')) {
            displayName = line.split(/\s{2,}/).slice(1).join(' ').trim();
          } else if (line.startsWith('UninstallString')) {
            uninstallString = line.split(/\s{2,}/).slice(1).join(' ').trim();
          }
        }
        if (
          displayName &&
          uninstallString &&
          displayName.toLowerCase().includes(productHint.toLowerCase())
        ) {
          return stripQuotes(uninstallString.split(/\s+/)[0] ?? uninstallString);
        }
      } catch {
        /* try next key */
      }
    }
  } catch {
    return null;
  }
  return null;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

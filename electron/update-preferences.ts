import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const DESKTOP_UPDATE_REGISTRY_KEY = 'HKCU\\Software\\xopc\\Desktop';

/** Installer-owned desktop preference. Missing or unreadable Windows consent fails closed. */
export async function automaticDesktopUpdatesEnabled(platform = process.platform, query = exec): Promise<boolean> {
  if (platform !== 'win32') return true;
  try {
    const { stdout } = await query(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe'),
      ['query', DESKTOP_UPDATE_REGISTRY_KEY, '/v', 'AutomaticUpdates', '/reg:64'],
      { windowsHide: true, timeout: 3000, maxBuffer: 8192 });
    return /^\s*AutomaticUpdates\s+REG_DWORD\s+0x1\s*$/im.test(String(stdout));
  } catch { return false; }
}

import { spawnSync } from 'node:child_process';

/** Resolve `fd` binary for pi-tui file autocomplete (`@path`, quoted paths). */
export function resolveFdPath(): string | null {
  if (process.platform === 'win32') {
    const where = spawnSync('where', ['fd'], { encoding: 'utf8' });
    const line = where.stdout?.trim().split(/\r?\n/)[0]?.trim();
    return line || null;
  }
  const which = spawnSync('which', ['fd'], { encoding: 'utf8' });
  const line = which.stdout?.trim();
  return line || null;
}

import fs from 'node:fs/promises';
import path from 'node:path';

/** Resolve Homebrew Cellar node paths to stable opt/bin symlinks. */
export async function resolveStableNodePath(nodePath: string): Promise<string> {
  const cellarMatch = nodePath.match(
    /^(.+?)[\\/]Cellar[\\/]([^\\/]+)[\\/][^\\/]+[\\/]bin[\\/]node$/,
  );
  if (!cellarMatch) return nodePath;

  const prefix = cellarMatch[1];
  const formula = cellarMatch[2];
  const pathModule = nodePath.includes('\\') ? path.win32 : path.posix;
  const optPath = pathModule.join(prefix, 'opt', formula, 'bin', 'node');
  try {
    await fs.access(optPath);
    return optPath;
  } catch {
    // fall through
  }

  if (formula === 'node') {
    const binPath = pathModule.join(prefix, 'bin', 'node');
    try {
      await fs.access(binPath);
      return binPath;
    } catch {
      // fall through
    }
  }

  return nodePath;
}

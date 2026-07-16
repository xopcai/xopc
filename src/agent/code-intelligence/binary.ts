import { createRequire } from 'node:module';
import { accessSync, constants, existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);

function binaryName(): string {
  return process.platform === 'win32' ? 'codebase-memory-mcp.exe' : 'codebase-memory-mcp';
}

function isUsableBinary(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    accessSync(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function packageBinaryPath(): string | undefined {
  try {
    const packageJson = require.resolve('codebase-memory-mcp/package.json');
    return join(dirname(packageJson), 'bin', binaryName());
  } catch {
    return undefined;
  }
}

export function resolveCodebaseMemoryBinary(explicitPath?: string): string {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    explicitPath,
    process.env.XOPC_CBM_BINARY,
    resourcesPath ? join(resourcesPath, 'bin', binaryName()) : undefined,
    packageBinaryPath(),
  ].filter((value): value is string => Boolean(value?.trim()));

  for (const candidate of candidates) {
    const absolute = resolve(candidate);
    if (isUsableBinary(absolute)) {
      return realpathSync(absolute);
    }
  }

  throw new Error(
    `codebase-memory-mcp binary is unavailable; checked ${candidates.join(', ') || 'no candidate paths'}`,
  );
}

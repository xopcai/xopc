import semver from 'semver';

import { runRuntimeCommand } from './command.js';
import type { RuntimeExecutables, RuntimeKind } from './types.js';

export function parseRuntimeVersion(output: string): string | null {
  const match = output.match(/v?(\d+\.\d+\.\d+)/);
  return match?.[1] ?? null;
}

export function versionSatisfies(actual: string, requested: string): boolean {
  const normalized = semver.valid(actual);
  if (!normalized) return false;
  if (/^\d+$/.test(requested)) return semver.major(normalized) === Number(requested);
  if (/^\d+\.\d+$/.test(requested)) {
    const [major, minor] = requested.split('.').map(Number);
    return semver.major(normalized) === major && semver.minor(normalized) === minor;
  }
  return semver.satisfies(normalized, requested) || normalized === requested;
}

function commandNames(runtime: RuntimeKind): string[] {
  if (runtime === 'node') return process.platform === 'win32' ? ['node.exe', 'node'] : ['node'];
  if (runtime === 'uv') return process.platform === 'win32' ? ['uv.exe', 'uv'] : ['uv'];
  return process.platform === 'win32'
    ? ['python.exe', 'python3.exe', 'python']
    : ['python3', 'python'];
}

export async function probeSystemRuntime(
  runtime: RuntimeKind,
  requestedVersion: string,
): Promise<{ version: string; executables: RuntimeExecutables } | null> {
  for (const command of commandNames(runtime)) {
    const versionResult = await runRuntimeCommand({ command, args: ['--version'] });
    if (!versionResult.ok) continue;
    const version = parseRuntimeVersion(`${versionResult.stdout}\n${versionResult.stderr}`);
    if (!version || !versionSatisfies(version, requestedVersion)) continue;

    if (runtime === 'node') {
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      const [npmResult, npxResult] = await Promise.all([
        runRuntimeCommand({ command: npm, args: ['--version'] }),
        runRuntimeCommand({ command: npx, args: ['--version'] }),
      ]);
      if (!npmResult.ok || !npxResult.ok) continue;
      return {
        version,
        executables: { primary: command, node: command, npm, npx },
      };
    }

    return {
      version,
      executables: runtime === 'uv'
        ? { primary: command, uv: command, uvx: process.platform === 'win32' ? 'uvx.exe' : 'uvx' }
        : { primary: command, python: command },
    };
  }
  return null;
}

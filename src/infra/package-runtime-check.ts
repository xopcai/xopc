import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createDefaultCommandRunner, type CommandRunner } from './run-command.js';

/** Check the candidate's complete gateway import graph in a fresh, isolated process. */
export async function verifyInstalledGatewayRuntime(params: {
  packageRoot: string;
  runCommand?: CommandRunner;
  env?: NodeJS.ProcessEnv;
}): Promise<string[]> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xopc-runtime-check-'));
  try {
    const entry = pathToFileURL(path.resolve(params.packageRoot, 'dist/src/gateway/index.js')).href;
    const script = `const module = await import(${JSON.stringify(entry)});
if (typeof module.GatewayServer !== 'function') throw new Error('Missing GatewayServer export');
process.exit(0);`;
    const probePath = path.join(stateDir, 'probe.mjs');
    await fs.writeFile(probePath, script);
    const result = await (params.runCommand ?? createDefaultCommandRunner())(
      [process.execPath, probePath],
      {
        cwd: params.packageRoot,
        timeoutMs: 30_000,
        env: {
          ...(params.env ?? process.env),
          XOPC_STATE_DIR: stateDir,
          XOPC_CONFIG: path.join(stateDir, 'xopc.json'),
          XOPC_CONFIG_PATH: path.join(stateDir, 'xopc.json'),
          XOPC_WORKSPACE: path.join(stateDir, 'workspace'),
          XOPC_LOG_DIR: path.join(stateDir, 'logs'),
          XOPC_LOG_CONSOLE: 'false',
          XOPC_LOG_FILE: 'false',
        },
      },
    );
    return result.code === 0 ? [] : [
      `Gateway runtime import failed: ${(result.stderr || result.stdout || `exit ${result.code}`).slice(-8000)}`,
    ];
  } catch (err) {
    return [`Gateway runtime import failed: ${err instanceof Error ? err.message : String(err)}`];
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
}

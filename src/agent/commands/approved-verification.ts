import { randomUUID } from 'node:crypto';

import { runProcess } from '../../process/run-process.js';
import { isolatedCommand, removeCommandContainer } from './command-isolation.js';

export class VerificationTerminationUnknownError extends Error {}

/** Tests are executable repository content: always sandboxed, no host fallback. */
export async function verifyTaskWorkspace(input: {
  workspace: string; image: string; command: string; signal: AbortSignal; guard: () => void; executionId?: string;
}): Promise<{ passed: boolean; output: string }> {
  input.guard(); input.signal.throwIfAborted();
  const command = await isolatedCommand({ id: input.executionId ?? randomUUID(), command: input.command, cwd: input.workspace, workspace: input.workspace,
    isolation: { mode: 'docker', image: input.image, network: false, workspaceAccess: 'read-only' } });
  try {
    const processResult = await runProcess({ program: command.executable, args: command.args, cwd: input.workspace,
      env: { PATH: process.env.PATH }, signal: input.signal, timeoutMs: 120_000, maxOutputBytes: 32_000, terminationPolicy: 'tree' });
    input.signal.throwIfAborted(); input.guard();
    return { passed: processResult.exitCode === 0 && !processResult.timedOut && !processResult.aborted,
      output: `${processResult.stdout}\n${processResult.stderr}`.slice(-32_000) };
  } finally {
    if (command.containerName) {
      try { await removeCommandContainer(command.containerName); }
      catch (cause) { throw new VerificationTerminationUnknownError('Verification container termination is unknown; reconcile before resuming', { cause }); }
    }
  }
}

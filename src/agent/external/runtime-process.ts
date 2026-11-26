import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { terminateProcess } from '../../process/kill-tree.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('ExternalRuntimeProcess');
const CLOSE_GRACE_MS = 1_000;

export async function closeRuntimeProcess(
  child: ChildProcessWithoutNullStreams,
  closed: Promise<void>,
  label: string,
  force: boolean,
): Promise<void> {
  if (!force) {
    child.stdin.end();
    await Promise.race([closed, delay(CLOSE_GRACE_MS, undefined, { ref: false })]);
  }
  const terminated = await terminateProcess(child, { tree: true, detached: true, graceMs: CLOSE_GRACE_MS });
  if (!terminated) log.warn({ pid: child.pid, runtime: label }, `Could not confirm that the ${label} process tree exited.`);
  child.stdin.destroy();
  child.stdout.destroy();
  child.stderr.destroy();
}

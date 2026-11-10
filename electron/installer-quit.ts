export const INSTALLER_QUIT_ARGUMENT = '--quit-for-install';

export function isInstallerQuitRequest(args: string[], platform: string, packaged: boolean): boolean {
  return platform === 'win32' && packaged && args.includes(INSTALLER_QUIT_ARGUMENT);
}

/** Bound shutdown even when a desktop connection never settles. */
export async function finishQuitCleanup(
  operations: Array<() => unknown>,
  reportFailure: (message: string) => void,
  timeoutMs = 12_000,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.allSettled(operations.map(operation => Promise.resolve().then(operation))).then(results => {
        const failures = results.filter(result => result.status === 'rejected');
        for (const failure of failures) reportFailure(String(failure.reason));
        return failures.length === 0;
      }),
      new Promise<boolean>(resolve => {
        timer = setTimeout(() => {
          reportFailure(`Quit cleanup timed out after ${timeoutMs}ms`);
          resolve(false);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

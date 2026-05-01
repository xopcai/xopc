import { drainAndStopTuiSafely, type DrainableTui } from './tui-lifecycle.js';

type StartableTui = DrainableTui & { start: () => void };

/**
 * Pause the TUI (drain stdin + stop), run async work with a normal terminal, then restart.
 * Caller should refocus the editor after `start()` if needed.
 */
export async function withTuiSuspended<T>(tui: StartableTui, work: () => Promise<T>): Promise<T> {
  await drainAndStopTuiSafely(tui);
  try {
    return await work();
  } finally {
    tui.start();
  }
}

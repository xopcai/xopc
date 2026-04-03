export type TypingController = {
  start: () => void;
  /** Clears the renew timer and awaits `onStop` (e.g. typing_off) before returning. */
  stop: () => Promise<void>;
};

export function createTypingController(params: {
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  intervalSeconds?: number;
}): TypingController {
  const { onStart, onStop, intervalSeconds = 5 } = params;
  let typingTimer: NodeJS.Timeout | null = null;
  let stopped = false;

  const start = () => {
    if (stopped) return;
    if (typingTimer) return;

    onStart().catch(() => {}); // typing is best-effort; errors must not propagate
    typingTimer = setInterval(() => {
      if (stopped) {
        void stop();
      } else {
        onStart().catch(() => {});
      }
    }, intervalSeconds * 1000);
  };

  const stop = async (): Promise<void> => {
    if (typingTimer) {
      clearInterval(typingTimer);
      typingTimer = null;
    }
    if (!stopped) {
      await onStop().catch(() => {}); // best-effort
    }
    stopped = true;
  };

  return { start, stop };
}

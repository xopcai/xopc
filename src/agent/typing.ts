export type TypingController = {
  start: () => void;
  stop: () => void;
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
        stop();
      } else {
        onStart().catch(() => {});
      }
    }, intervalSeconds * 1000);
  };

  const stop = () => {
    if (typingTimer) {
      clearInterval(typingTimer);
      typingTimer = null;
    }
    if (!stopped) {
      onStop().catch(() => {}); // best-effort
    }
    stopped = true;
  };

  return { start, stop };
}

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

    onStart();
    typingTimer = setInterval(() => {
      if (stopped) {
        stop();
      } else {
        onStart();
      }
    }, intervalSeconds * 1000);
  };

  const stop = () => {
    if (typingTimer) {
      clearInterval(typingTimer);
      typingTimer = null;
    }
    if (!stopped) {
      onStop();
    }
    stopped = true;
  };

  return { start, stop };
}

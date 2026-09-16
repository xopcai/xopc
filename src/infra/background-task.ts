/** Run one background tick at a time, reporting once per consecutive failure period. */
export function createBackgroundTask(
  run: () => void | Promise<void>,
  onError: (error: unknown) => void,
): () => void {
  let running = false;
  let failed = false;
  return () => {
    if (running) return;
    running = true;
    void (async () => {
      try {
        await run();
        failed = false;
      } catch (error) {
        if (!failed) {
          failed = true;
          onError(error);
        }
      } finally {
        running = false;
      }
    })();
  };
}

/** Submission acceptance and the lifetime of its streamed run are separate events. */
export function trackInputAcceptance(run: (accepted: () => void) => Promise<void>): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    void Promise.resolve().then(() => run(() => resolve(true))).then(
      () => resolve(false),
      () => resolve(false),
    );
  });
}

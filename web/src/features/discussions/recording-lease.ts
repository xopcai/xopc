/** Browser-owned locks are released on process death, so recovery never needs a stale timeout. */
export async function acquireRecordingLease(id: string): Promise<() => void> {
  if (!navigator.locks) return () => {};
  return new Promise((resolve, reject) => {
    void navigator.locks.request(`xopc-recording:${id}`, { ifAvailable: true }, async lock => {
      if (!lock) { reject(new Error('This recording is open in another tab. Close it before recovery.')); return; }
      await new Promise<void>(release => resolve(release));
    }).catch(reject);
  });
}

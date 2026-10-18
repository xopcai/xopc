const receivers = new Map<string, (file: File) => Promise<boolean>>();
export function registerComposerFileReceiver(id: string, receiver: (file: File) => Promise<boolean>) {
  receivers.set(id, receiver);
  return () => { if (receivers.get(id) === receiver) receivers.delete(id); };
}
export async function referenceFileInComposer(id: string, file: File): Promise<boolean> {
  return await receivers.get(id)?.(file) ?? false;
}

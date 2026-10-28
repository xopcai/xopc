import type { Attachment } from '../attachments/attachment-utils';

type Receiver = (id: string, attachments: Attachment[]) => Promise<void>;
const receivers = new Map<string, Receiver>();
const listeners = new Set<() => void>();
export function registerExternalIntakeReceiver(scope: string, receiver: Receiver): () => void {
  receivers.set(scope, receiver);
  for (const listener of listeners) listener();
  return () => { if (receivers.get(scope) === receiver) receivers.delete(scope); };
}
/** Wait for navigation and draft hydration before appending. Never broadcasts to other composers. */
export async function deliverExternalIntake(scope: string, id: string, attachments: Attachment[]): Promise<void> {
  const receiver = receivers.get(scope) ?? await new Promise<Receiver>((resolve, reject) => {
    const check = () => {
      const ready = receivers.get(scope);
      if (ready) { clearTimeout(timeout); listeners.delete(check); resolve(ready); }
    };
    const timeout = setTimeout(() => { listeners.delete(check); reject(new Error('Chat input is not ready. Please retry.')); }, 15_000);
    listeners.add(check);
    check();
  });
  await receiver(id, attachments);
}

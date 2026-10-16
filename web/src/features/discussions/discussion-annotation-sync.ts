import type { DiscussionAnnotation } from '@xopcai/gateway-contract';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { acknowledgeLocalAnnotation, listLocalAnnotations } from './discussion-annotation-store';

const inFlight = new Map<string,Promise<void>>();
export function syncDiscussionAnnotations(recordingId: string,discussionId: string): Promise<void> {
  const key = `${recordingId}:${discussionId}`;
  if (inFlight.has(key)) return inFlight.get(key)!;
  const running = (async () => {
    for (let pass = 0; pass < 5; pass++) {
    const pending = (await listLocalAnnotations(recordingId)).filter(row => row.state === 'pending');
    if (!pending.length) return;
    for (const row of pending) {
      if (row.state !== 'pending') continue;
      const annotation = row.annotation;
      try {
        const remote = await fetchJson<DiscussionAnnotation>(apiUrl(`/api/discussions/${encodeURIComponent(discussionId)}/annotations/${encodeURIComponent(annotation.id)}`), {
          method: 'PUT', signal: AbortSignal.timeout(15_000), body: JSON.stringify({ id: annotation.id, kind: annotation.kind, text: annotation.text,
            anchor: annotation.anchor, expectedRevision: annotation.revision, deleted: annotation.deleted }),
        });
        await acknowledgeLocalAnnotation(row,remote);
      } catch (error) {
        if ((error as { status?: number }).status === 409) await acknowledgeLocalAnnotation(row,undefined,true);
        throw error;
      }
    }
    }
    throw new Error('Highlights are still being updated. Saved local changes will sync on retry.');
  })().finally(() => inFlight.delete(key));
  inFlight.set(key,running); return running;
}

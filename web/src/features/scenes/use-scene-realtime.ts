import { useEffect } from 'react';
import { useSWRConfig } from 'swr';

import { subscribeRealtimeTopic } from '@/features/gateway/gateway-realtime';
import { createResourceChangeConsumer } from '@/features/gateway/resource-change';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

/** Runs inside the scene-only cache; global SWR mutation cannot reach this provider. */
export function useSceneRealtime() {
  const { mutate } = useSWRConfig();
  useEffect(() => {
    let generation = 0;
    let stop: (() => void) | undefined;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (pending !== undefined) return;
      pending = setTimeout(() => { pending = undefined; void mutate(() => true); }, 50);
    };
    const consume = createResourceChangeConsumer(change => { if (change.kind === 'scene') refresh(); });
    const connect = async () => {
      const current = ++generation;
      stop?.(); stop = undefined;
      try {
        const { capabilities } = await fetchJson<{ capabilities: Array<{ id: string }> }>(apiUrl('/api/capabilities/operations'));
        if (current !== generation) return;
        if (!capabilities.some(item => item.id === 'xopc.scenes.list')) {
          if (pending !== undefined) clearTimeout(pending);
          pending = undefined;
          void mutate(() => true, undefined, { revalidate: true });
          return;
        }
        stop = subscribeRealtimeTopic('resources:scenes', {
          onEvent: event => { if (event.event === 'resource.changed') consume(event.topic, event.data); },
          onGap: refresh,
        }, 0);
        refresh();
      } catch { /* A later authenticated connection retries discovery. */ }
    };
    const onConnected = () => { void connect(); };
    window.addEventListener('gateway-realtime-connected', onConnected);
    void connect();
    return () => {
      generation++; stop?.();
      if (pending !== undefined) clearTimeout(pending);
      window.removeEventListener('gateway-realtime-connected', onConnected);
    };
  }, [mutate]);
}

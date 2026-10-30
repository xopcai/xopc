import type { SessionInputControlCommand, SessionInputControlView } from '@xopcai/gateway-contract';

import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';

const controls = new Map<string, SessionInputControlView>();
const revisions = new Map<string, number>();
const key = (id: string) => `${useGatewayStore.getState().conversationId}:${id}`;
export function readInputControl(id: string): SessionInputControlView {
  return controls.get(key(id)) ?? { paused: false, version: 0, phase: 'idle', reviewRequired: false };
}
export function rememberInputControl(id: string, control: SessionInputControlView, revision?: number): boolean {
  const scope = key(id);
  const previous = revisions.get(scope);
  if (revision !== undefined && previous !== undefined && revision < previous) return false;
  if (revision === undefined) revisions.delete(scope);
  else revisions.set(scope, revision);
  controls.set(scope, control);
  return true;
}
export async function requestInputControl(id: string, command: SessionInputControlCommand): Promise<unknown> {
  const gateway = useGatewayStore.getState().conversationId;
  const url = apiUrl(`/api/sessions/${encodeURIComponent(id)}/input-control`);
  let scopeChanged = false;
  const assertScope = () => {
    if (scopeChanged || gateway !== useGatewayStore.getState().conversationId) throw new DOMException('Gateway changed', 'AbortError');
  };
  // The same operation ID is reused when a response is lost.
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    assertScope();
    const abort = new AbortController();
    const unsubscribe = useGatewayStore.subscribe(state => { if (state.conversationId !== gateway) { scopeChanged = true; abort.abort(); } });
    const timer = setTimeout(() => abort.abort(), 10_000);
    try {
      const res = await apiFetch(url, {
        method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command),
      });
      const json = await res.json() as { payload?: unknown; error?: { message?: string } };
      assertScope();
      if (!res.ok) throw Object.assign(new Error(json.error?.message ?? 'Input control failed'), { definitive: res.status < 500 });
      return json.payload;
    } catch (error) {
      assertScope();
      lastError = error;
      if ((error as { definitive?: boolean }).definitive) throw error;
    } finally { clearTimeout(timer); unsubscribe(); }
  }
  throw lastError;
}

import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type RuntimeKind = 'node' | 'uv' | 'python';
export type RuntimePreference = 'managed-first' | 'system-first' | 'managed-only' | 'system-only';
export type RuntimeProvision = 'eager' | 'on-demand' | 'disabled';

export type RuntimeToolsConfig = {
  enabled: boolean;
  node: { enabled: boolean; version?: string; preference: RuntimePreference; provision: RuntimeProvision };
  python: { enabled: boolean; version?: string; preference: RuntimePreference; provision: RuntimeProvision };
  uv: { enabled: boolean; version?: string };
  download: {
    bundleDir?: string;
    proxy?: string;
    source: 'auto' | 'website-only' | 'direct-only';
    gatewayBaseUrl: string;
    timeoutMs: number;
  };
  retention: { keepVersions: number; maxCacheBytes?: number };
};

export type RuntimeStatus = {
  runtime: RuntimeKind;
  state: 'disabled' | 'unsupported' | 'absent' | 'installing' | 'ready' | 'degraded' | 'corrupted' | 'failed';
  requestedVersion: string;
  message: string;
  repairable: boolean;
  resolved?: { version: string; source: 'managed' | 'system'; executable: string };
};

export type RuntimeProgress = {
  runtime: RuntimeKind;
  phase: string;
  message: string;
  downloadedBytes?: number;
  totalBytes?: number;
};

type RuntimePayload = { ok: true; payload: { config: RuntimeToolsConfig; statuses: RuntimeStatus[] } };

export async function loadRuntimeTools(): Promise<RuntimePayload> {
  return fetchJson<RuntimePayload>(apiUrl('/api/runtime-tools'));
}

export async function saveRuntimeToolsConfig(config: RuntimeToolsConfig): Promise<void> {
  await fetchJson(apiUrl('/api/runtime-tools/config'), {
    method: 'PATCH',
    body: JSON.stringify(config),
  });
}

export async function pruneRuntimeTools(): Promise<{ removed: string[]; reclaimedBytes: number }> {
  const response = await fetchJson<{
    ok: true;
    payload: { removed: string[]; reclaimedBytes: number };
  }>(apiUrl('/api/runtime-tools/prune'), { method: 'POST' });
  return response.payload;
}

export async function runRuntimeOperation(params: {
  runtime: RuntimeKind;
  action: 'install' | 'repair';
  version?: string;
  onProgress: (event: RuntimeProgress) => void;
}): Promise<void> {
  return streamManagedToolOperation<RuntimeProgress>({
    path: `/api/runtime-tools/${params.runtime}/${params.action}/stream`,
    body: { version: params.version }, onProgress: params.onProgress,
  });
}

export async function streamManagedToolOperation<T>(params: {
  path: string; body: unknown; onProgress(event: T): void;
}): Promise<void> {
  const response = await apiFetch(apiUrl(params.path), {
    method: 'POST', headers: { Accept: 'text/event-stream' }, body: JSON.stringify(params.body),
  });
  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(error.message ?? `HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let resultSeen = false;
  try {
    while (!resultSeen) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        let event = '';
        let data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          if (line.startsWith('data:')) data += line.slice(5).trimStart();
        }
        if (!data) continue;
        const payload = JSON.parse(data) as { ok?: boolean; message?: string } & T;
        if (event === 'progress') params.onProgress(payload);
        if (event === 'result') {
          resultSeen = true;
          if (!payload.ok) throw new Error(payload.message ?? 'Dependency operation failed');
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (!resultSeen) throw new Error('Runtime operation ended without a result');
}

import { Archive } from 'lucide-react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import type { TurnOutcomeDeliverable } from '@xopcai/gateway-contract';

import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

async function readArtifact(path: string): Promise<{ id: string; versionId?: string } | null> {
  const response = await apiFetch(apiUrl(path));
  if (!response.ok) return null;
  const payload = await response.json() as { id?: unknown; versionId?: unknown };
  return typeof payload.id === 'string'
    ? { id: payload.id, versionId: typeof payload.versionId === 'string' ? payload.versionId : undefined }
    : null;
}

function SpaceLookupLink({ path, zh, title }: { path: string | null; zh: boolean; title?: string }) {
  const { data } = useSWR(path, readArtifact, { shouldRetryOnError: false });
  if (!data) return null;
  const params = new URLSearchParams({ item: data.id });
  if (data.versionId) params.set('version', data.versionId);
  return <Link to={`/space?${params}`} title={title}
    className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg">
    <Archive className="size-3.5" aria-hidden />{zh ? '在 Space 中查看' : 'View in Space'}
  </Link>;
}

export function SpaceArtifactLink({ file, zh }: { file: TurnOutcomeDeliverable; zh: boolean }) {
  const mediaId = file.uri?.startsWith('media://outbound/') ? file.uri.slice('media://outbound/'.length) : null;
  return <SpaceLookupLink path={mediaId ? `/api/spaces/artifacts/${mediaId}` : null} title={file.title} zh={zh} />;
}

export function SpaceTaskResultLink({ deliveryId, title, zh }: { deliveryId: string; title: string; zh: boolean }) {
  return <SpaceLookupLink path={`/api/spaces/deliveries/${encodeURIComponent(deliveryId)}`} title={title} zh={zh} />;
}

export function SpaceGeneratedMediaLink({ mediaId, title, zh }: { mediaId: string; title: string; zh: boolean }) {
  return <SpaceLookupLink path={`/api/spaces/artifacts/${encodeURIComponent(mediaId)}`} title={title} zh={zh} />;
}

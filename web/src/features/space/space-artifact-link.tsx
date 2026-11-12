import { Archive } from 'lucide-react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import type { TurnOutcomeDeliverable } from '@xopcai/gateway-contract';

import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import { SaveSpaceVersionDialog } from './save-space-version-dialog';

async function readArtifact(path: string): Promise<{ id: string; versionId?: string; canSaveAsVersion: boolean } | null> {
  const response = await apiFetch(apiUrl(path));
  if (!response.ok) return null;
  const payload = await response.json() as { id?: unknown; versionId?: unknown; canSaveAsVersion?: unknown };
  return typeof payload.id === 'string'
    ? { id: payload.id, versionId: typeof payload.versionId === 'string' ? payload.versionId : undefined,
      canSaveAsVersion: payload.canSaveAsVersion === true }
    : null;
}

function SpaceLookupLink({ path, zh, title, readonly }: { path: string | null; zh: boolean; title?: string; readonly?: boolean }) {
  const { data, mutate } = useSWR(path, readArtifact, { shouldRetryOnError: false });
  if (!data) return null;
  const params = new URLSearchParams({ item: data.id });
  if (data.versionId) params.set('version', data.versionId);
  return <span className="inline-flex flex-wrap items-center gap-1"><Link to={`/space?${params}`} title={title}
    className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg">
    <Archive className="size-3.5" aria-hidden />{zh ? '在 Space 中查看' : 'View in Space'}
  </Link>
    {!readonly && data.canSaveAsVersion && data.versionId && title ? <SaveSpaceVersionDialog sourceVersionId={data.versionId}
      title={title} zh={zh} onSaved={result => {
        void mutate({ ...result, canSaveAsVersion: false }, { revalidate: false });
        const destination = new URLSearchParams({ item: result.id, version: result.versionId });
        showComposerNotification('success', zh ? '已保存为新版本' : 'Saved as new version', undefined, { href: `/space?${destination}` });
      }} /> : null}
  </span>;
}

export function SpaceArtifactLink({ file, zh, readonly }: { file: TurnOutcomeDeliverable; zh: boolean; readonly?: boolean }) {
  const mediaId = file.uri?.startsWith('media://outbound/') ? file.uri.slice('media://outbound/'.length) : null;
  return <SpaceLookupLink path={mediaId ? `/api/spaces/artifacts/${mediaId}` : null} title={file.title} zh={zh} readonly={readonly} />;
}

export function SpaceTaskResultLink({ deliveryId, title, zh }: { deliveryId: string; title: string; zh: boolean }) {
  return <SpaceLookupLink path={`/api/spaces/deliveries/${encodeURIComponent(deliveryId)}`} title={title} zh={zh} />;
}

export function SpaceGeneratedMediaLink({ mediaId, title, zh }: { mediaId: string; title: string; zh: boolean }) {
  return <SpaceLookupLink path={`/api/spaces/artifacts/${encodeURIComponent(mediaId)}`} title={title} zh={zh} />;
}

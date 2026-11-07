import type { LocalAppResourceScopes } from '@xopcai/gateway-contract';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { confirmExtensionUiGrant, resolveExtensionUiGrant } from '@/features/extensions/extension-authoritative-grants';
import { ExtensionPermissionDialog } from '@/features/extensions/extension-permission-dialog';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export function LocalAppAccessPanel({ extensionId, name, zh }: { extensionId: string; name: string; zh: boolean }) {
  const { data: grant, error: loadError, mutate } = useSWR(['local-app-access', extensionId], () => resolveExtensionUiGrant(extensionId));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(scopes?: LocalAppResourceScopes) {
    if (!grant?.manifestDigest || busy) return;
    setBusy(true); setError('');
    try { await confirmExtensionUiGrant(extensionId, grant.manifestDigest, scopes); await mutate(); setOpen(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function revoke() {
    if (!grant?.manifestDigest || busy) return;
    setBusy(true); setError('');
    try {
      await fetchJson(apiUrl(`/api/extensions/${encodeURIComponent(extensionId)}/ui-grant`), { method: 'DELETE', body: JSON.stringify({ manifestDigest: grant.manifestDigest }) });
      await mutate();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <div className="mt-3 space-y-2">
    {!grant && !loadError ? <Skeleton className="h-12" /> : <>
      <p className="text-xs text-fg-muted">{grant?.granted ? zh ? '已授权，可随时缩小数据范围或撤销访问。' : 'Access granted. You can narrow the data scope or revoke access.'
        : zh ? '尚未授权访问。' : 'Access has not been granted.'}</p>
      <Button className="w-full" disabled={!grant || busy} onClick={() => setOpen(true)}>{zh ? '管理数据访问范围' : 'Manage data access'}</Button>
      {grant?.granted ? <Button variant="ghost" className="w-full text-danger" disabled={busy} onClick={() => void revoke()}>{zh ? '撤销应用授权' : 'Revoke app access'}</Button> : null}
    </>}
    {error || loadError ? <p role="alert" className="text-xs text-danger">{error || String(loadError)}</p> : null}
    {grant ? <ExtensionPermissionDialog open={open} onOpenChange={setOpen} extensionId={extensionId} extensionName={name}
      permissions={grant.permissions} localApp resourceScopes={grant.resourceScopes} error={error} confirmDisabled={busy || !grant.manifestDigest} onConfirm={scopes => void save(scopes)} /> : null}
  </div>;
}

import type { CapabilityProvider } from '@xopcai/endpoint-tools-protocol';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

type Provider = { principalId: string; provider: CapabilityProvider; digest: string; admitted: boolean; status: string };
const labels: Record<string, [string, string]> = {
  ready: ['可用', 'Ready'], offline: ['离线', 'Offline'], authorization_required: ['等待批准', 'Approval required'],
  needs_foreground: ['需要设备前台运行', 'Foreground required'], permission_missing: ['缺少设备权限', 'Device permission required'],
  resource_busy: ['资源占用中', 'Resource busy'], unavailable: ['暂不可用', 'Unavailable'],
};

export function DeviceProviders({ principalId, zh }: { principalId: string; zh: boolean }) {
  const path = apiUrl('/api/endpoint-tools/providers');
  const { data, error, mutate } = useSWR(`${path}?principalId=${encodeURIComponent(principalId)}`, url => fetchJson<{ ok: boolean; payload: Provider[] }>(url), { refreshInterval: 15_000 });
  const [saving, setSaving] = useState<string>();
  const [failure, setFailure] = useState(false);
  const providers = data?.payload.filter(item => item.principalId === principalId);
  const admit = async (item: Provider) => {
    setSaving(item.provider.localId); setFailure(false);
    try {
      await fetchJson(path + '/admission', { method: 'POST', body: JSON.stringify({ principalId, localId: item.provider.localId,
        expectedDigest: item.digest, allowed: !item.admitted }) });
      await mutate();
    } catch { setFailure(true); await mutate(); }
    finally { setSaving(undefined); }
  };
  return <section className="space-y-2">
    <h3 className="text-sm font-semibold text-fg">{zh ? '设备能力' : 'Device capabilities'}</h3>
    {!data && !error ? <Skeleton className="h-24 w-full rounded-xl" /> : null}
    {error || failure ? <p role="alert" className="text-sm text-danger">{zh ? '能力信息更新失败，请刷新后重试。' : 'Unable to update capabilities. Refresh and retry.'}</p> : null}
    {providers?.length === 0 ? <p className="text-sm text-fg-muted">{zh ? '此设备尚未上报扩展能力。' : 'No additional capabilities reported.'}</p> : null}
    {providers?.map(item => <article key={item.provider.localId} className="space-y-2 rounded-xl border border-edge-subtle p-3">
      <div className="flex items-start justify-between gap-2">
        <h4 className="break-words text-sm font-medium text-fg">{item.provider.title}</h4>
        <span className="shrink-0 text-xs text-fg-muted">{(labels[item.status] ?? labels.unavailable)[zh ? 0 : 1]}</span>
      </div>
      <p className="break-words text-xs text-fg-muted">{item.provider.summary}</p>
      <details className="text-xs text-fg-subtle">
        <summary className="cursor-pointer">{zh ? `${item.provider.tools.length} 项能力及权限` : `${item.provider.tools.length} tools and permissions`}</summary>
        <ul className="mt-2 space-y-2">{item.provider.tools.map(tool => <li key={tool.name} className="break-words">
          <p className="font-medium text-fg">{tool.title}</p><p>{tool.description}</p>
          <p>{tool.effect} · {tool.sensitivity} · {tool.confirmation === 'always' ? (zh ? '每次确认' : 'Confirm each call') : (zh ? '按批准范围执行' : 'Approved scope')}{tool.requiredPermissions.length ? ` · ${tool.requiredPermissions.join(', ')}` : ''}</p>
        </li>)}</ul>
      </details>
      <Button variant="secondary" disabled={saving !== undefined} onClick={() => void admit(item)}>
        {saving === item.provider.localId ? (zh ? '保存中…' : 'Saving…') : item.admitted ? (zh ? '撤销能力批准' : 'Revoke approval') : (zh ? '批准这些能力' : 'Approve capabilities')}
      </Button>
    </article>)}
  </section>;
}

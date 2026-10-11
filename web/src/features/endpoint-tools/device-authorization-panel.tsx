import { useState } from 'react';
import useSWR from 'swr';
import type { LocationRequest } from '@xopcai/endpoint-tools-protocol';

import { Button } from '@/components/ui/button';
import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { listSessions } from '@/features/sessions/session-api';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import type { ManagedDevice } from './management-api';

interface DeviceAuthorization { id: string; conversationId: string; targetEndpointId: string; toolName: string; expiresAt: number; state: string }
async function grantRequest(method = 'GET', body?: object, id?: string): Promise<any> {
  const response = await apiFetch(apiUrl('/api/endpoint-tools/target-authorizations' + (id ? '/' + encodeURIComponent(id) : '')), {
    method, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(response.status === 403 ? 'owner' : 'unavailable');
  const result = await response.json(); return result.payload;
}
export function DeviceAuthorizationPanel({ devices, zh }: { devices: ManagedDevice[]; zh: boolean }) {
  const grants = useSWR<DeviceAuthorization[]>('device-single-call-grants', () => grantRequest(), { refreshInterval: 5000, shouldRetryOnError: false });
  const sessions = useSWR(grants.error ? null : 'device-grant-conversations', () => listSessions({ limit: 100 }), { shouldRetryOnError: false });
  const [conversationId, setConversationId] = useState(''); const [requestor, setRequestor] = useState(''); const [target, setTarget] = useState('');
  const [purpose, setPurpose] = useState<LocationRequest['purpose']>('weather'); const [precision, setPrecision] = useState<LocationRequest['precision']>('approximate');
  const [category, setCategory] = useState('restaurant'); const [busy, setBusy] = useState(false); const [failed, setFailed] = useState(false);
  if (grants.error) return null;
  const endpoints = devices.flatMap(device => device.endpoints.map(endpoint => ({ ...endpoint, label: device.displayName + ' · ' + device.platform + ' · ' + device.id.slice(-8) })));
  const selected = endpoints.find(endpoint => endpoint.endpointId === target);
  const tool = selected?.tools.find(item => item.descriptor.name.endsWith('.device.get_location'))?.descriptor.name;
  const create = async () => {
    if (!tool || !conversationId || !requestor) return; setBusy(true); setFailed(false);
    try { await grantRequest('POST', { conversationId, requestorPrincipalId: requestor, targetEndpointId: target, toolName: tool,
      arguments: { purpose, precision, ...(purpose === 'nearby' ? { category } : {}) } }); await grants.mutate(); }
    catch { setFailed(true); } finally { setBusy(false); }
  };
  return <section className="mb-5 rounded-xl border border-edge bg-surface-base p-4">
    <h3 className="font-semibold text-fg">{zh ? '跨设备单次授权' : 'Single-call device authorization'}</h3>
    <p className="mt-1 text-sm text-fg-muted">{zh ? '为指定会话和来源设备授权一次定位查询，60 秒后失效。目标设备仍需确认；授权后请在来源设备继续请求。' : 'Authorize one location query for a conversation and source device. Expires in 60 seconds; target-device consent is still required. Continue the request from the source device.'}</p>
    {grants.isLoading || sessions.isLoading ? <Skeleton className="mt-3 h-28" /> : <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <PopoverSelect value={conversationId} onChange={setConversationId} placeholder={zh ? '选择会话' : 'Conversation'} ariaLabel={zh ? '会话' : 'Conversation'} options={(sessions.data?.items ?? []).map(session => ({ value: session.key, label: session.name || session.key }))} />
      <PopoverSelect value={requestor} onChange={setRequestor} placeholder={zh ? '消息来源设备' : 'Source device'} ariaLabel={zh ? '消息来源设备' : 'Source device'} options={devices.filter(device => device.endpoints.length > 0).map(device => ({ value: device.id, label: device.displayName + ' · ' + device.platform + ' · ' + device.id.slice(-8) }))} />
      <PopoverSelect value={target} onChange={setTarget} placeholder={zh ? '使用哪台设备的位置' : 'Location device'} ariaLabel={zh ? '目标设备' : 'Target device'} options={endpoints.filter(endpoint => endpoint.tools.some(item => item.descriptor.name.endsWith('.device.get_location'))).map(endpoint => ({ value: endpoint.endpointId, label: endpoint.label }))} />
      <PopoverSelect placeholder={zh ? "用途" : "Purpose"} value={purpose} onChange={value => setPurpose(value as LocationRequest['purpose'])} ariaLabel={zh ? '用途' : 'Purpose'} options={[{ value: 'weather', label: zh ? '查询天气' : 'Weather' }, { value: 'nearby', label: zh ? '附近地点' : 'Nearby places' }]} allowEmpty={false} />
      <PopoverSelect placeholder={zh ? "精度" : "Precision"} value={precision} onChange={value => setPrecision(value as LocationRequest['precision'])} ariaLabel={zh ? '精度' : 'Precision'} options={[{ value: 'approximate', label: zh ? '大致位置' : 'Approximate' }, { value: 'precise', label: zh ? '精确位置' : 'Precise' }]} allowEmpty={false} />
      {purpose === 'nearby' ? <PopoverSelect placeholder={zh ? "地点类型" : "Category"} value={category} onChange={setCategory} ariaLabel={zh ? '附近地点类型' : 'Place category'} options={['restaurant', 'cafe', 'pharmacy', 'park'].map((value, index) => ({ value, label: zh ? ['餐厅', '咖啡馆', '药店', '公园'][index] : value }))} allowEmpty={false} /> : null}
      <Button variant="primary" disabled={busy || !conversationId || !requestor || !tool} onClick={() => void create()}>{zh ? '允许一次' : 'Allow once'}</Button>
    </div>}
    {failed ? <p role="alert" className="mt-2 text-sm text-fg-muted">{zh ? '授权失败，请检查设备连接后重试。' : 'Authorization failed. Check the device connection.'}</p> : null}
    <div className="mt-3 space-y-2">{grants.data?.map(grant => <div key={grant.id} className="flex items-center justify-between gap-2 text-sm text-fg-muted"><span>{devices.find(device => device.endpoints.some(endpoint => endpoint.endpointId === grant.targetEndpointId))?.displayName ?? (zh ? '设备' : 'Device')} · {grant.state === 'running' ? (zh ? '执行中' : 'Running') : (zh ? '等待本次调用' : 'Awaiting one call')}</span><Button disabled={busy} onClick={() => { setBusy(true); void grantRequest('DELETE', undefined, grant.id).then(() => grants.mutate()).catch(() => setFailed(true)).finally(() => setBusy(false)); }}>{zh ? '撤销' : 'Revoke'}</Button></div>)}</div>
  </section>;
}

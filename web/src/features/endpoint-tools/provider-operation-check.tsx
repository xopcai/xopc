import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export function ProviderOperationCheck({ operationId, zh }: { operationId: string; zh: boolean }) {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  return <>
    <Button variant="ghost" className="h-7 px-2 text-xs" disabled={checking} onClick={async () => {
      setChecking(true);
      try {
        const reply = await fetchJson<{ payload: { receipt?: { state: 'succeeded' | 'running' | 'unknown' } } }>(apiUrl(`/api/endpoint-tools/provider-operations/${encodeURIComponent(operationId)}`));
        const state = reply.payload.receipt?.state;
        setMessage(state === 'succeeded' ? (zh ? '设备报告已完成，Gateway 未收到结果。' : 'Device reported completion. Gateway did not receive the result.')
          : state === 'running' ? (zh ? '设备仍在执行。' : 'Device is still running.')
            : (zh ? '设备未确认结果。' : 'Device has not confirmed the outcome.'));
      } catch { setMessage(zh ? '暂时无法核对设备状态。' : 'Unable to check device status.'); }
      finally { setChecking(false); }
    }}>{checking ? (zh ? '核对中…' : 'Checking…') : (zh ? '核对设备状态' : 'Check device status')}</Button>
    {message ? <p role="status" className="text-right text-xs text-fg-muted">{message}</p> : null}
  </>;
}

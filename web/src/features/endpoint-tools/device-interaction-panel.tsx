import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';

type Interaction = { requestId: string; message: string; inputSchema: { properties?: Record<string, { type?: string; title?: string; enum?: unknown[] }>; required?: string[] } };

function DeviceForm({ interaction, path, complete }: { interaction: Interaction; path: string; complete: () => void }) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const [text, setText] = useState('{}');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const submit = async (action: 'accept' | 'decline') => {
    setPending(true); setError(false);
    try {
      const content: unknown = action === 'accept' ? JSON.parse(text) : undefined;
      if (action === 'accept' && (!content || typeof content !== 'object' || Array.isArray(content))) throw new Error('Expected an object');
      await fetchJson(path, { method: 'POST', body: JSON.stringify({ requestId: interaction.requestId, action, content }) });
      complete();
    } catch { setError(true); }
    finally { setPending(false); }
  };
  const fields = Object.entries(interaction.inputSchema.properties ?? {});
  return <form className="space-y-2 rounded-xl border border-edge bg-surface p-3 text-sm" onSubmit={event => { event.preventDefault(); void submit('accept'); }}>
    <p className="font-medium text-fg">{zh ? '设备需要补充信息' : 'Device needs input'}</p>
    <p className="whitespace-pre-wrap break-words text-fg-muted">{interaction.message}</p>
    {fields.length ? <ul className="max-h-24 overflow-y-auto text-xs text-fg-muted">
      {fields.map(([name, field]) => <li key={name}>{name}{field.type ? ` (${field.type})` : ''}{interaction.inputSchema.required?.includes(name) ? ' *' : ''}
        {Array.isArray(field.enum) ? ` · ${JSON.stringify(field.enum).slice(0, 180)}` : ''}</li>)}
    </ul> : null}
    <textarea value={text} onChange={event => setText(event.target.value)} maxLength={7000}
      aria-label={zh ? '设备请求参数（JSON）' : 'Device response (JSON)'}
      className="h-16 w-full resize-none rounded-md border border-edge bg-surface p-2 font-mono text-xs" />
    {error ? <p role="alert" className="text-xs text-danger">{zh ? '输入不符合要求，或设备请求已结束。' : 'The input is invalid or the device request has ended.'}</p> : null}
    <div className="flex justify-end gap-2">
      <Button type="button" variant="secondary" disabled={pending} onClick={() => void submit('decline')}>{zh ? '拒绝' : 'Decline'}</Button>
      <Button type="submit" disabled={pending}>{zh ? '提交给设备' : 'Send to device'}</Button>
    </div>
  </form>;
}

export function DeviceInteractionPanel({ conversationId, active }: { conversationId?: string | null; active: boolean }) {
  const path = conversationId ? apiUrl(`/api/endpoint-tools/interactions/${encodeURIComponent(conversationId)}`) : null;
  const { data, mutate } = useSWR(path, url => fetchJson<{ payload: Interaction[] }>(url), { refreshInterval: active ? 1500 : 5000, shouldRetryOnError: false });
  const interaction = data?.payload?.[0];
  return path && interaction ? <DeviceForm key={interaction.requestId} interaction={interaction} path={path} complete={() => { void mutate(); }} /> : null;
}

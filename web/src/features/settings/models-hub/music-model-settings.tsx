import * as Dialog from '@radix-ui/react-dialog';
import type { MusicMode, MusicModelSettings } from '@xopcai/gateway-contract';
import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';

import { Button } from '@/components/ui/button';
import { PopoverSelect, Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import { ModelUseRow, ModelUseService } from './model-use-layout';

const settingsUrl = () => apiUrl('/api/music-generation/settings');

function providerLabel(provider: string, zh: boolean): string {
  if (provider === 'mureka-cn') return zh ? 'Mureka 中国站' : 'Mureka China';
  if (provider === 'mureka-global') return zh ? 'Mureka 国际站' : 'Mureka Global';
  return provider;
}

export function MusicModelSettingsPanel({ zh, disabled }: { zh: boolean; disabled?: boolean }) {
  const { data, error, mutate } = useSWR<MusicModelSettings>(settingsUrl(), fetchJson<MusicModelSettings>);
  const { mutate: mutateCache } = useSWRConfig();
  const [provider, setProvider] = useState<string>();
  const [defaults, setDefaults] = useState<{ modelRef: string; mode: MusicMode }>();
  const [apiKey, setApiKey] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState('');
  const selected = data?.models.find(model => model.ref === data.modelRef);
  const defaultModel = data?.models.find(model => model.ref === defaults?.modelRef);
  const modeLabel = (mode: MusicMode) => mode === 'song' ? (zh ? '歌曲' : 'Song') : (zh ? '纯音乐' : 'Instrumental');
  const credential = provider ? data?.credentials[provider] : undefined;
  const credentialLabel = (source: MusicModelSettings['credentials'][string] | undefined) => {
    if (source === 'saved') return zh ? '已保存 API Key' : 'API key saved';
    if (source === 'environment') return zh ? '使用环境变量' : 'Using an environment variable';
    return zh ? '待连接' : 'Connection needed';
  };

  async function save(url: string, method: 'PUT' | 'PATCH' | 'DELETE', body?: object) {
    if (disabled || pending) return false;
    setPending(true);
    setFailure('');
    try {
      const updated = await fetchJson<MusicModelSettings>(url, { method, body: body && JSON.stringify(body) });
      await mutate(updated, { revalidate: false });
      void mutateCache(key => typeof key === 'string' && key.startsWith(apiUrl('/api/music-generation/sessions/')));
      return true;
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setPending(false);
    }
  }

  function close() {
    setProvider(undefined);
    setDefaults(undefined);
    setApiKey('');
    setFailure('');
  }

  return <div data-capability="music">
    <ModelUseRow actionColumn
      description={<>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-sm font-medium text-fg">{zh ? '创作音乐' : 'Music generation'}</p>
          {selected && <span className="text-xs text-fg-subtle">{credentialLabel(data?.credentials[selected.providerId])}</span>}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-fg-muted">{zh ? '生成带歌词的歌曲和纯音乐' : 'Generate songs with lyrics and instrumental tracks'}</p>
      </>}
      picker={data && selected ? <>
        <PopoverSelect placeholder={zh ? '选择模型' : 'Choose a model'}
          ariaLabel={zh ? '选择音乐生成模型' : 'Select music generation model'}
          value={data.modelRef} allowEmpty={false} triggerClassName="min-h-11"
          disabled={disabled || pending}
          onChange={ref => { if (ref !== data.modelRef) void save(settingsUrl(), 'PUT', { modelRef: ref }); }}
          options={data.models.map(model => ({ value: model.ref, label: model.name, group: providerLabel(model.providerId, zh) }))} />
        <ModelUseService name={providerLabel(selected.providerId, zh)} manageLabel={zh ? '管理服务' : 'Manage services'}
          disabled={disabled || pending} onManage={() => { setFailure(''); setProvider(selected.providerId); }} />
        {pending && !provider && !defaults && <p role="status" className="text-xs text-fg-muted">{zh ? '正在切换…' : 'Switching…'}</p>}
        {!provider && !defaults && failure && <p role="alert" className="text-xs text-danger">{failure}</p>}
      </> : error ? <div role="alert" className="text-sm text-danger">
        {zh ? '音乐模型加载失败' : 'Could not load music models'}
        <Button variant="ghost" onClick={() => void mutate()}>{zh ? '重试' : 'Retry'}</Button>
      </div> : <Skeleton className="h-11 w-full rounded-xl" />}
      actions={data && selected && <Button variant="ghost" className="min-h-11" disabled={disabled || pending} onClick={() => {
        setFailure('');
        setDefaults({ modelRef: data.modelRef, mode: data.defaults?.mode ?? selected.modes[0] ?? 'song' });
      }}>{zh ? '设置' : 'Settings'}</Button>}
    />
    <Dialog.Root open={Boolean(defaults)} onOpenChange={open => { if (!open && !pending) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[150] bg-scrim" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[151] flex h-[min(20rem,calc(100dvh-2rem))] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay">
          <header className="border-b border-edge px-5 py-4">
            <Dialog.Title className="font-semibold text-fg">{zh ? '音乐生成设置' : 'Music generation settings'}</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-fg-muted">
              {defaultModel && [providerLabel(defaultModel.providerId, zh), defaultModel.name].join(' · ')}
            </Dialog.Description>
          </header>
          {defaults && defaultModel && <form className="flex min-h-0 flex-1 flex-col" onSubmit={async event => {
            event.preventDefault();
            if (await save(settingsUrl(), 'PATCH', defaults)) close();
          }}>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4 text-sm">
              <label htmlFor="music-default-mode" className="block font-medium text-fg">{zh ? '默认创作类型' : 'Default creation type'}</label>
              <Select id="music-default-mode" value={defaults.mode} disabled={pending}
                onChange={event => setDefaults({ ...defaults, mode: event.target.value as MusicMode })}>
                {defaultModel.modes.map(mode => <SelectOption key={mode} value={mode}>{modeLabel(mode)}</SelectOption>)}
              </Select>
              <p className="text-xs text-fg-muted">{zh ? '聊天中未指定类型时使用。' : 'Used when the chat request does not specify a type.'}</p>
              {failure && <p role="alert" className="break-words text-xs text-danger">{failure}</p>}
            </div>
            <footer className="flex justify-end gap-2 border-t border-edge px-5 py-3">
              <Dialog.Close asChild><Button variant="ghost" disabled={pending}>{zh ? '取消' : 'Cancel'}</Button></Dialog.Close>
              <Button type="submit" variant="primary" disabled={disabled || pending}>{pending ? (zh ? '正在保存…' : 'Saving…') : (zh ? '保存' : 'Save')}</Button>
            </footer>
          </form>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    <Dialog.Root open={Boolean(provider)} onOpenChange={open => { if (!open && !pending) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[150] bg-scrim" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[151] flex h-[min(20rem,calc(100dvh-2rem))] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay">
          <header className="border-b border-edge px-5 py-4">
            <Dialog.Title className="font-semibold text-fg">{provider && providerLabel(provider, zh)}</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-fg-muted">{credentialLabel(credential)}</Dialog.Description>
          </header>
          {provider && <form className="flex min-h-0 flex-1 flex-col" onSubmit={async event => {
            event.preventDefault();
            if (!apiKey.trim()) return;
            if (await save(`${settingsUrl()}/credentials/${encodeURIComponent(provider)}`, 'PUT', { apiKey })) close();
          }}>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <label className="block text-sm font-medium text-fg" htmlFor="music-provider-api-key">API Key</label>
              <input id="music-provider-api-key" type="password" autoComplete="new-password" value={apiKey}
                maxLength={4096} disabled={pending} onChange={event => setApiKey(event.target.value)}
                className="min-h-11 w-full rounded-lg border border-edge bg-surface-inset px-3 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
              {failure && <p role="alert" className="break-words text-xs text-danger">{failure}</p>}
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-edge px-5 py-3">
              {credential === 'saved' && <Button variant="ghost" type="button" className="mr-auto" disabled={pending} onClick={async () => {
                if (await save(`${settingsUrl()}/credentials/${encodeURIComponent(provider)}`, 'DELETE')) close();
              }}>{zh ? '移除密钥' : 'Remove key'}</Button>}
              <Dialog.Close asChild><Button variant="ghost" disabled={pending}>{zh ? '取消' : 'Cancel'}</Button></Dialog.Close>
              <Button type="submit" variant="primary" disabled={disabled || pending || !apiKey.trim()}>{pending ? (zh ? '正在保存…' : 'Saving…') : (zh ? '保存' : 'Save')}</Button>
            </footer>
          </form>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </div>;
}

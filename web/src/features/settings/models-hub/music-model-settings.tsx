import * as Dialog from '@radix-ui/react-dialog';
import { creditDecimal, TENCENT_MPS_MUSIC_PROVIDER, type MusicMode, type MusicModelSettings } from '@xopcai/gateway-contract';
import { ArrowUpRight } from 'lucide-react';
import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';

import { Button } from '@/components/ui/button';
import { PopoverSelect, Select, SelectOption } from '@/components/ui/popover-select';
import { SecretInput } from '@/components/ui/secret-input';
import { Skeleton } from '@/components/ui/skeleton';
import { revealProviderApiKey } from '@/features/settings/providers-api';
import { fetchJson } from '@/lib/fetch';
import { isMaskedSecret } from '@/lib/is-masked-secret';
import { apiUrl } from '@/lib/url';

import { ModelUseRow, ModelUseService } from './model-use-layout';

const settingsUrl = () => apiUrl('/api/music-generation/settings');
const apiKeyPortals = new Map([
  ['mureka-cn', 'https://platform.mureka.cn/'],
  ['mureka-global', 'https://platform.mureka.ai/'],
]);
const tencentFields = { secretId: 'SecretId', secretKey: 'SecretKey' } as const;
const tencentFieldNames = ['secretId', 'secretKey'] as const;
type TencentField = typeof tencentFieldNames[number];

function providerLabel(provider: string, zh: boolean): string {
  if (provider === 'mureka-cn') return zh ? 'Mureka 中国站' : 'Mureka China';
  if (provider === 'mureka-global') return zh ? 'Mureka 国际站' : 'Mureka Global';
  if (provider === TENCENT_MPS_MUSIC_PROVIDER) return zh ? '腾讯云媒体处理（MPS）' : 'Tencent Cloud MPS';
  return provider === 'xopc-cloud' ? 'XOPC Cloud' : provider;
}

export function MusicModelSettingsPanel({ zh, disabled, onManageCloud }: { zh: boolean; disabled?: boolean; onManageCloud?: () => void }) {
  const { data, error, mutate } = useSWR<MusicModelSettings>(settingsUrl(), fetchJson<MusicModelSettings>);
  const { mutate: mutateCache } = useSWRConfig();
  const [provider, setProvider] = useState<string>();
  const [defaults, setDefaults] = useState<{ modelRef: string; mode: MusicMode }>();
  const [apiKey, setApiKey] = useState<string>();
  const [tencentKeys, setTencentKeys] = useState<Partial<Record<TencentField, string>>>({});
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState('');
  const selected = data?.models.find(model => model.ref === data.modelRef);
  const defaultModel = data?.models.find(model => model.ref === defaults?.modelRef);
  const modeLabel = (mode: MusicMode) => mode === 'song' ? (zh ? '歌曲' : 'Song') : (zh ? '纯音乐' : 'Instrumental');
  const credential = provider ? data?.credentials[provider] : undefined;
  const apiKeyPortal = provider ? apiKeyPortals.get(provider) : undefined;
  const isTencent = provider === TENCENT_MPS_MUSIC_PROVIDER;
  const credentialUrl = provider ? `${settingsUrl()}/credentials/${encodeURIComponent(provider)}` : '';
  const displayedKey = apiKey ?? (credential === 'saved' ? '••••••••••••' : '');
  const replacementKey = apiKey?.trim() ?? '';
  const canSaveKey = isTencent ? tencentFieldNames.every(field => {
    const value = tencentKeys[field]?.trim() ?? '';
    return value && !isMaskedSecret(value);
  }) : Boolean(replacementKey && !isMaskedSecret(replacementKey));
  const credentialLabel = (source: MusicModelSettings['credentials'][string] | undefined) => {
    if (source === 'saved') return zh ? '已保存密钥' : 'Credentials saved';
    if (source === 'oauth') return zh ? '已连接' : 'Connected';
    if (source === 'environment') return zh ? '使用环境变量' : 'Using environment variables';
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
    setApiKey(undefined);
    setTencentKeys({});
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
          disabled={disabled || pending} onManage={selected.providerId === 'xopc-cloud' ? onManageCloud : () => { setFailure(''); setProvider(selected.providerId); }} />
        {selected.creditMicroPerTrack && <p className="text-xs text-fg-muted">
          {creditDecimal(String(selected.creditMicroPerTrack))} {zh ? 'Credits / 首' : 'Credits / track'}
        </p>}
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
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[151] flex h-[min(23rem,calc(100dvh-2rem))] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay">
          <header className="border-b border-edge px-5 py-4">
            <Dialog.Title className="font-semibold text-fg">{provider && providerLabel(provider, zh)}</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-fg-muted">{credentialLabel(credential)}</Dialog.Description>
          </header>
          {provider && <form className="flex min-h-0 flex-1 flex-col" onSubmit={async event => {
            event.preventDefault();
            if (!canSaveKey) return;
            if (await save(credentialUrl, 'PUT', isTencent ? tencentKeys : { apiKey: replacementKey })) close();
          }}>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {isTencent ? <>
                {tencentFieldNames.map(field => {
                  const value = tencentKeys[field] ?? (credential === 'saved' ? '••••••••••••' : '');
                  const name = tencentFields[field];
                  return <div key={field} className="space-y-1.5">
                    <label htmlFor={`music-provider-${field}`} className="block text-sm font-medium text-fg">{name}</label>
                    <SecretInput id={`music-provider-${field}`} autoComplete="new-password" value={value}
                      disabled={disabled || pending}
                      onChange={next => setTencentKeys(current => ({
                        ...current, [field]: isMaskedSecret(value) ? next.replace(/^•+/, '') : next,
                      }))}
                      labels={zh ? { show: `显示 ${name}`, hide: `隐藏 ${name}`, copy: `复制 ${name}`, copied: '已复制' }
                        : { show: `Show ${name}`, hide: `Hide ${name}`, copy: `Copy ${name}`, copied: 'Copied' }}
                      reveal={credential === 'saved' ? () => fetchJson<{ value: string | null }>(credentialUrl, {
                        method: 'POST', body: JSON.stringify({ field }),
                      }).then(result => result.value) : undefined}
                      allowUnrevealedCopy
                      loadFailedLabel={zh ? '无法读取已保存的密钥。' : 'Could not load the saved credential.'} />
                  </div>;
                })}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <a href="https://console.cloud.tencent.com/mps" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-fg hover:underline">
                    {zh ? '开通腾讯云 MPS' : 'Activate Tencent Cloud MPS'}<ArrowUpRight className="size-3.5" aria-hidden />
                  </a>
                  <a href="https://console.cloud.tencent.com/cam/capi" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-fg hover:underline">
                    {zh ? '管理腾讯云 API 密钥' : 'Manage Tencent Cloud API keys'}<ArrowUpRight className="size-3.5" aria-hidden />
                  </a>
                </div>
                <p className="text-xs text-fg-muted">{zh ? '请填写同一对密钥。更新时需重新填写两项。' : 'Enter a matching pair. Fill in both fields when replacing credentials.'}</p>
              </> : <>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <label className="text-sm font-medium text-fg" htmlFor="music-provider-api-key">API Key</label>
                  {apiKeyPortal && <a href={apiKeyPortal} target="_blank" rel="noreferrer"
                    className="inline-flex min-h-8 items-center gap-1 rounded-sm text-xs text-accent-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                    {zh ? '获取 API Key' : 'Get an API key'}<ArrowUpRight className="size-3.5" aria-hidden />
                  </a>}
                </div>
                <SecretInput key={provider} id="music-provider-api-key" autoComplete="new-password"
                  value={displayedKey} disabled={disabled || pending}
                  onChange={next => setApiKey(isMaskedSecret(displayedKey) ? next.replace(/^•+/, '') : next)}
                  placeholder={zh ? '粘贴 API Key' : 'Paste your API key'}
                  labels={zh ? { show: '显示密钥', hide: '隐藏密钥', copy: '复制密钥', copied: '已复制' }
                    : { show: 'Show key', hide: 'Hide key', copy: 'Copy key', copied: 'Copied' }}
                  reveal={credential === 'saved' ? () => revealProviderApiKey(provider).then(result => result.apiKey) : undefined}
                  allowUnrevealedCopy
                  loadFailedLabel={zh ? '无法读取已保存的 API Key。' : 'Could not load the saved API key.'}
                  notInConfigFile={zh ? '网关中没有可查看的密钥。' : 'No saved key is available to show.'} />
                {apiKeyPortal && <p className="text-xs leading-relaxed text-fg-muted">
                  {zh ? '登录对应站点的 Mureka 开放平台，在「API Keys」创建密钥，然后粘贴到这里并保存。'
                    : 'Sign in to this region’s Mureka API platform, create a key under API Keys, then paste it here and save.'}
                </p>}
              </>}
              {failure && <p role="alert" className="break-words text-xs text-danger">{failure}</p>}
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-edge px-5 py-3">
              {credential === 'saved' && <Button variant="ghost" type="button" className="mr-auto" disabled={pending} onClick={async () => {
                if (await save(credentialUrl, 'DELETE')) close();
              }}>{zh ? '移除密钥' : 'Remove key'}</Button>}
              <Dialog.Close asChild><Button variant="ghost" disabled={pending}>{zh ? '取消' : 'Cancel'}</Button></Dialog.Close>
              <Button type="submit" variant="primary" disabled={disabled || pending || !canSaveKey}>{pending ? (zh ? '正在保存…' : 'Saving…') : (zh ? '保存' : 'Save')}</Button>
            </footer>
          </form>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </div>;
}

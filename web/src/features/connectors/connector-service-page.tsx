import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { SecretInput } from '@/components/ui/secret-input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { OAuthProviderConnect } from '@/features/settings/models-hub/oauth-provider-connect';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { configureComposio, getComposioSetupStatus, selectComposioBackend, removeComposioBackend } from './connectors-api';

export function ConnectorServicePage() {
  const language = useLocaleStore(state => state.language);
  const t = messages(language).connectorsSettings;
  const zh = language === 'zh';
  return <main className="mx-auto w-full max-w-2xl space-y-6 p-6">
    <Link to="/connectors" className="text-sm text-accent-fg">{t.title}</Link>
    <h1 className="text-xl font-semibold">{zh ? '应用连接服务' : 'App connection service'}</h1>
    <p className="text-sm text-fg-muted"><ConnectorServiceDescription /></p>
    <ConnectorServiceForm />
  </main>;
}

function ConnectorServiceDescription() {
  const zh = useLocaleStore(state => state.language) === 'zh';
  return <>{zh ? '此设置决定新账号通过哪个服务连接。已有账号继续使用其原来的连接服务。' : 'Choose the service for new accounts. Existing accounts keep their original service.'}</>;
}

export function ConnectorServiceDialog() {
  const language = useLocaleStore(state => state.language);
  const t = messages(language).connectorsSettings;
  const zh = language === 'zh';
  return <Dialog.Root>
    <Dialog.Trigger asChild>
      <Button type="button" variant="secondary" className="shrink-0">
        {zh ? '应用连接服务' : 'Connection service'}
      </Button>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
      <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[60] flex h-[min(100dvh-2rem,42rem)] w-[min(100%-2rem,42rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay shadow-float">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-edge-subtle px-6 py-5">
          <div className="min-w-0">
            <Dialog.Title className="text-base font-semibold text-fg">{zh ? '应用连接服务' : 'App connection service'}</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-fg-muted"><ConnectorServiceDescription /></Dialog.Description>
          </div>
          <Dialog.Close asChild>
            <Button variant="ghost" className="shrink-0 p-1.5" aria-label={t.modalClose}><X className="size-5" aria-hidden /></Button>
          </Dialog.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <ConnectorServiceForm />
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function ConnectorServiceForm() {
  const language = useLocaleStore(state => state.language);
  const t = messages(language).connectorsSettings;
  const zh = language === 'zh';
  const { data, error, mutate } = useSWR('connector-service', getComposioSetupStatus);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [removeId, setRemoveId] = useState<string>();
  async function run(operation: () => Promise<void>) {
    setBusy(true); setFailure(undefined);
    try { await operation(); setKey(''); await mutate(); }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <div className="space-y-6">
    {!data && !error ? <Skeleton className="h-40 w-full" /> : null}
    {data ? <>
      <section className="space-y-3 rounded-xl border border-edge p-4">
        <h2 className="font-medium">XOPC Cloud</h2>
        <p className="text-sm text-fg-muted">{t.composioSetupHint}</p>
        <OAuthProviderConnect providerId="xopc-cloud" displayName="XOPC Cloud" connected={data.mode === 'managed' && data.configured} onConnected={() => { void mutate(); }} />
        <Button variant="secondary" disabled={busy || (data.mode === 'managed' && data.configured)} onClick={() => void run(() => selectComposioBackend({ mode: 'managed' }))}>
          {data.mode === 'managed' ? (zh ? '当前服务' : 'Current service') : (zh ? '使用 XOPC Cloud' : 'Use XOPC Cloud')}
        </Button>
      </section>
      <details className="rounded-xl border border-edge p-4">
        <summary className="cursor-pointer text-sm font-medium">{t.composioSetupByok}</summary>
        <div className="mt-4 space-y-3">
          <ol className="list-inside list-decimal text-sm text-fg-muted"><li>{t.composioSetupStepProject}</li><li>{t.composioSetupStepKey}</li><li>{t.composioSetupStepPaste}</li></ol>
          <a href="https://app.composio.dev" target="_blank" rel="noreferrer" className="text-sm text-accent-fg">{t.composioSetupOpenDashboard}</a>
          <label className="block space-y-2 text-sm"><span>Composio API key</span><SecretInput value={key} onChange={setKey} labels={t.secretInputLabels} placeholder={t.composioSetupKeyPlaceholder} /></label>
          <p className="text-xs text-fg-subtle">{t.composioSetupStorageHint}</p>
          <Button disabled={busy || !key.trim()} onClick={() => void run(() => configureComposio(key))}>{zh ? '验证并使用新项目' : 'Verify and use new project'}</Button>
          <p className="text-xs text-fg-subtle">{zh ? '验证只检查连接服务和现有账号访问，不执行写入。工具权限在实际使用时检查。环境变量密钥需在运行环境中修改。' : 'Verification checks service and existing account access without writes. Tool permissions are checked on use. Environment keys must be updated in the gateway environment.'}</p>
          <p className="text-xs text-fg-subtle">{t.composioSessionWritePermissionHint}</p>
          {data.backends?.filter(item => item.mode === 'byok').map(backend => <div key={backend.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="min-w-0"><p>{backend.label}</p><p className="text-xs text-fg-muted">{backend.credentialSource === 'environment' ? (zh ? '环境变量' : 'Environment') : (zh ? '本地保存' : 'Stored locally')}
              {backend.verifiedAt && ` · ${new Date(backend.verifiedAt).toLocaleString()}`}</p></div>
            <Button variant="ghost" disabled={busy || !key.trim() || backend.credentialSource === 'environment'} onClick={() => void run(() => configureComposio(key, backend.id))}>
              {zh ? '用上方密钥更新' : 'Update with key above'}
            </Button>
            <Button variant="ghost" disabled={busy || backend.id === data.backendId} onClick={() => void run(() => selectComposioBackend({ backendId: backend.id }))}>
              {backend.id === data.backendId ? (zh ? '当前服务' : 'Current service') : (zh ? '使用' : 'Use')}
            </Button>
            <Button variant="ghost" disabled={busy || backend.id === data.backendId} onClick={() => setRemoveId(backend.id)}>{zh ? '移除' : 'Remove'}</Button>
          </div>)}
        </div>
      </details>
    </> : null}
    {failure || error ? <p role="alert" className="text-sm text-danger">{failure ?? String(error)}</p> : null}
    <ConfirmDialog open={Boolean(removeId)} title={zh ? '移除连接服务' : 'Remove connection service'}
      description={zh ? '移除此服务及其本地保存的密钥，不修改环境变量。需要先切换服务并断开该项目的账号，已有数据不会删除。' : 'Remove this service and its saved key, without changing environment variables. Switch services and disconnect this project’s accounts first. Existing data is retained.'}
      confirmLabel={zh ? '移除' : 'Remove'} cancelLabel={t.modalCancel} destructive
      onCancel={() => setRemoveId(undefined)} onConfirm={() => { const id = removeId; setRemoveId(undefined); if (id) void run(() => removeComposioBackend(id)); }} />
  </div>;
}

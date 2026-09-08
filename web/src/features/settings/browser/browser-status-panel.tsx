import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
  PlugZap,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { AutosaveStatus } from '@/lib/use-autosave';

import {
  fetchBrowserStatus,
  installBrowserExtension,
  openBrowserExtension,
  testBrowserConnection,
  type BrowserDriverKind,
  type BrowserExtensionStatus,
  type PlaywrightDoctorStatus,
} from './browser-control-api';
import { usePlaywrightInstall } from './use-playwright-install';

const driverNames: Record<BrowserDriverKind, string> = {
  extension: 'Chrome extension',
  playwright: 'Playwright Chromium',
  cdp: 'CDP',
  remote: 'Remote browser',
};

export function BrowserStatusPanel(props: {
  enabled: boolean;
  driverKind: BrowserDriverKind;
  autosaveStatus: AutosaveStatus;
  zh: boolean;
}) {
  const { enabled, driverKind, autosaveStatus, zh } = props;
  const status = useSWR(
    enabled ? ['browser-control-status', driverKind] : null,
    fetchBrowserStatus,
    { revalidateOnFocus: true, refreshInterval: driverKind === 'extension' ? 3_000 : 0 },
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const configPending = autosaveStatus === 'dirty' || autosaveStatus === 'saving';

  useEffect(() => {
    if (autosaveStatus === 'saved') void status.mutate();
  }, [autosaveStatus, status.mutate]);

  const run = useCallback(async (name: string, action: () => Promise<unknown>, done: string) => {
    setBusy(name);
    setOperationError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(done);
      await status.mutate();
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, [status.mutate]);

  const playwrightInstall = usePlaywrightInstall(useCallback(() => {
    setSuccess(zh ? 'Chromium 已安装，可以开始连接测试。' : 'Chromium is installed and ready to test.');
    void status.mutate();
  }, [status.mutate, zh]));

  const payload = status.data?.payload;
  const isCurrent = payload?.driverKind === driverKind;
  const effectiveState = !enabled ? 'disabled' : configPending || !isCurrent ? 'syncing' : payload?.state;
  const stateCopy = effectiveState === 'ready'
    ? (zh ? '已就绪' : 'Ready')
    : effectiveState === 'disabled'
      ? (zh ? '未启用' : 'Disabled')
      : effectiveState === 'syncing'
        ? (zh ? '正在应用配置' : 'Applying configuration')
        : (zh ? '需要处理' : 'Needs attention');
  const StateIcon = effectiveState === 'ready' ? CheckCircle2 : effectiveState === 'syncing' ? Loader2 : AlertTriangle;

  return (
    <section className="rounded-xl border border-edge bg-surface-base p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StateIcon className={`size-4 shrink-0 ${effectiveState === 'ready' ? 'text-success' : effectiveState === 'syncing' ? 'animate-spin text-fg-muted' : effectiveState === 'disabled' ? 'text-fg-subtle' : 'text-warning'}`} />
            <h2 className="text-sm font-semibold text-fg">{zh ? '浏览器就绪状态' : 'Browser readiness'}</h2>
            <span className={`rounded-full px-2 py-0.5 text-xs ${effectiveState === 'ready' ? 'bg-success-soft text-success' : effectiveState === 'disabled' ? 'bg-surface-hover text-fg-muted' : 'bg-warning-soft text-warning'}`}>{stateCopy}</span>
          </div>
          <p className="mt-2 text-sm text-fg-muted">
            {driverNames[driverKind]}
            {payload?.detail && isCurrent ? ` · ${payload.detail}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" className="h-9" onClick={() => void status.mutate()} disabled={status.isValidating}>
            <RefreshCw className={`size-3.5 ${status.isValidating ? 'animate-spin' : ''}`} />
            {zh ? '刷新' : 'Refresh'}
          </Button>
          <Button
            variant="secondary"
            className="h-9"
            disabled={!enabled || configPending || busy !== null || playwrightInstall.running}
            onClick={() => void run('test', testBrowserConnection, zh ? '连接测试成功。' : 'Connection test passed.')}
          >
            {busy === 'test' ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
            {zh ? '测试连接' : 'Test connection'}
          </Button>
        </div>
      </div>

      {enabled && status.isLoading ? <div className="mt-4 grid gap-2 sm:grid-cols-3"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : null}
      {enabled && status.error ? <Message tone="error">{status.error instanceof Error ? status.error.message : String(status.error)}</Message> : null}
      {operationError || playwrightInstall.error ? <Message tone="error">{operationError ?? playwrightInstall.error}</Message> : null}
      {success ? <Message tone="success">{success}</Message> : null}

      {enabled && driverKind === 'extension' && isCurrent ? (
        <ExtensionSetup
          status={payload?.driverStatus as BrowserExtensionStatus | undefined}
          zh={zh}
          busy={busy}
          run={run}
        />
      ) : null}
      {enabled && driverKind === 'playwright' && isCurrent ? (
        <PlaywrightSetup
          status={payload?.driverStatus as PlaywrightDoctorStatus | undefined}
          zh={zh}
          installer={playwrightInstall}
        />
      ) : null}
      {enabled && driverKind === 'cdp' ? (
        <p className="mt-4 rounded-lg bg-surface-subtle px-3 py-2 text-xs leading-5 text-fg-muted">
          {zh ? '连接测试会验证已保存的 CDP 地址，并复用浏览器中现有的标签页和登录状态。' : 'The connection test verifies the saved CDP endpoint and reuses that browser’s existing tabs and signed-in state.'}
        </p>
      ) : null}
      {enabled && driverKind === 'remote' ? (
        <p className="mt-4 rounded-lg bg-surface-subtle px-3 py-2 text-xs leading-5 text-fg-muted">
          {zh ? '连接测试会在服务商侧创建一个临时浏览器会话，并在测试结束后立即关闭。' : 'The connection test creates a temporary provider session and closes it immediately after the test.'}
        </p>
      ) : null}
    </section>
  );
}

function ExtensionSetup(props: {
  status?: BrowserExtensionStatus;
  zh: boolean;
  busy: string | null;
  run: (name: string, action: () => Promise<unknown>, done: string) => Promise<void>;
}) {
  const { status, zh, busy, run } = props;
  const artifacts = status?.artifacts;
  return (
    <div className="mt-4 border-t border-edge-subtle pt-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <StatusItem label={zh ? '扩展文件' : 'Extension files'} ok={artifacts?.installed === true} value={artifacts?.installed ? (zh ? '已安装' : 'Installed') : (zh ? '未安装或需更新' : 'Install or update required')} />
        <StatusItem label={zh ? '本地桥接' : 'Local bridge'} ok={status?.running === true} value={status?.running ? (zh ? '运行中' : 'Running') : (zh ? '未运行' : 'Stopped')} />
        <StatusItem label={zh ? 'Chrome 连接' : 'Chrome connection'} ok={status?.connected === true} value={status?.connected ? (zh ? '已连接' : 'Connected') : status?.socketConnected ? (zh ? '需要重新加载扩展' : 'Reload extension') : (zh ? '等待扩展连接' : 'Waiting for extension')} />
      </div>
      <p className="mt-3 break-all text-xs text-fg-subtle">{artifacts?.extensionDir ?? '127.0.0.1:19820'}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button className="h-9" variant={artifacts?.installed ? 'secondary' : 'primary'} disabled={busy !== null} onClick={() => void run('extension-install', () => installBrowserExtension(Boolean(artifacts?.installed)), zh ? '扩展文件已准备好。' : 'Extension files are ready.')}>
          {busy === 'extension-install' ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          {artifacts?.installed ? (zh ? '刷新扩展文件' : 'Refresh files') : (zh ? '安装扩展文件' : 'Install extension')}
        </Button>
        <Button className="h-9" variant="secondary" disabled={!artifacts?.installed || busy !== null} onClick={() => void run('extension-open', () => openBrowserExtension('chrome'), zh ? '已打开 Chrome 扩展页。' : 'Chrome extensions opened.')}>
          <ExternalLink className="size-3.5" />{zh ? '打开扩展页' : 'Open extensions'}
        </Button>
        <Button className="h-9" variant="ghost" disabled={!artifacts?.installed || busy !== null} onClick={() => void run('extension-folder', () => openBrowserExtension('folder'), zh ? '已打开扩展目录。' : 'Extension folder opened.')}>
          <FolderOpen className="size-3.5" />{zh ? '打开扩展目录' : 'Open folder'}
        </Button>
      </div>
      {!status?.connected ? <p className="mt-3 text-xs leading-5 text-fg-muted">{status?.socketConnected ? (zh ? '扩展仍在运行旧协议。请打开 Chrome 扩展页，找到 xopc Browser Bridge 并点击“重新加载”，然后刷新状态。' : 'The extension is still running an older protocol. Open Chrome Extensions, find xopc Browser Bridge, click Reload, then refresh status.') : (zh ? '首次使用：打开 Chrome 扩展页，开启“开发者模式”，选择“加载已解压的扩展程序”，然后选择上面的扩展目录。' : 'First use: open Chrome Extensions, enable Developer mode, choose Load unpacked, then select the extension folder shown above.')}</p> : null}
    </div>
  );
}

function PlaywrightSetup(props: {
  status?: PlaywrightDoctorStatus;
  zh: boolean;
  installer: ReturnType<typeof usePlaywrightInstall>;
}) {
  const { status, zh, installer } = props;
  return (
    <div className="mt-4 border-t border-edge-subtle pt-4">
      <StatusItem label="Chromium" ok={status?.installed === true} value={status?.installed ? (zh ? '已安装' : 'Installed') : (status?.reason ?? (zh ? '未安装' : 'Not installed'))} />
      {status?.executablePath ? <p className="mt-2 break-all text-xs text-fg-subtle">{status.executablePath}</p> : null}
      {installer.progress ? (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-fg-muted"><span>{installer.progress.message ?? installer.progress.phase}</span><span>{installer.progress.percent == null ? '' : `${Math.round(installer.progress.percent)}%`}</span></div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-hover"><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${installer.progress.percent ?? 8}%` }} /></div>
        </div>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button variant={status?.installed ? 'secondary' : 'primary'} className="h-9" disabled={installer.running} onClick={() => void installer.install()}>
          {installer.running ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          {status?.installed ? (zh ? '重新安装 Chromium' : 'Reinstall Chromium') : (zh ? '安装 Chromium' : 'Install Chromium')}
        </Button>
        {installer.running ? <Button variant="ghost" className="h-9" disabled={installer.cancelling} onClick={() => void installer.cancel()}>{installer.cancelling ? (zh ? '正在取消…' : 'Cancelling…') : (zh ? '取消' : 'Cancel')}</Button> : null}
      </div>
    </div>
  );
}

function StatusItem({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return <div className="rounded-lg bg-surface-subtle px-3 py-2"><p className="text-xs text-fg-subtle">{label}</p><p className={`mt-1 flex items-center gap-1.5 text-sm ${ok ? 'text-success' : 'text-fg-muted'}`}><span className={`size-1.5 rounded-full ${ok ? 'bg-success' : 'bg-warning'}`} />{value}</p></div>;
}

function Message({ tone, children }: { tone: 'success' | 'error'; children: React.ReactNode }) {
  return <p className={`mt-3 rounded-lg px-3 py-2 text-xs ${tone === 'success' ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</p>;
}

import { Download, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleStore } from '@/stores/locale-store';
import { installPhoneDependency, loadPhoneDependencies, phoneDependenciesKey, useExistingPhoneAdb, type PhoneDependencyKind, type PhoneDependencyProgress } from './phone-dependencies-api';

export function PhoneDependenciesCard({ cloudOnly = false, onChanged }: { cloudOnly?: boolean; onChanged?(): void }) {
  const zh = useLocaleStore(s => s.language) === 'zh';
  const [busy, setBusy] = useState<PhoneDependencyKind>();
  const [showLocal, setShowLocal] = useState(false);
  const [paths, setPaths] = useState({ adb: '', scrcpy: '' });
  const [progress, setProgress] = useState<PhoneDependencyProgress>();
  const [feedback, setFeedback] = useState('');
  const [failed, setFailed] = useState(false);
  const { data, error, mutate } = useSWR(phoneDependenciesKey(), loadPhoneDependencies, { refreshInterval: busy ? 2500 : 0 });
  const labels = zh ? { ready: '已就绪', absent: '未安装', corrupted: '需要修复', unsupported: '当前平台需自行安装', installing: '安装中' }
    : { ready: 'Ready', absent: 'Not installed', corrupted: 'Needs repair', unsupported: 'Use an existing installation', installing: 'Installing' };
  const phases: Record<string, string> = zh ? { download: '下载中', verify: '校验文件', extract: '解压文件', install: '安装中', probe: '验证版本', complete: '安装完成' }
    : { download: 'Downloading', verify: 'Verifying files', extract: 'Extracting', install: 'Installing', probe: 'Checking version', complete: 'Installed' };
  async function perform(kind: PhoneDependencyKind, action: 'install' | 'repair' | 'existing' | 'detect') {
    setBusy(kind); setFailed(false); setFeedback(''); setProgress(undefined);
    try {
      if (action === 'detect') await useExistingPhoneAdb('');
      else if (action === 'existing' && kind === 'adb') await useExistingPhoneAdb(paths.adb.trim());
      else await installPhoneDependency(kind, action === 'existing' ? 'import' : action, setProgress, action === 'existing' ? paths.scrcpy.trim() : undefined);
      await mutate(); onChanged?.();
      setFeedback(zh ? '依赖已就绪。' : 'Dependency is ready.');
    } catch (cause) { setFailed(true); setFeedback(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(undefined); setProgress(undefined); }
  }
  return <section className="space-y-4 rounded-2xl border border-edge bg-surface-panel p-4 sm:p-5" aria-label={zh ? '手机依赖状态' : 'Phone dependencies'}>
    <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">{zh ? '手机依赖状态' : 'Phone dependencies'}</h2><Button variant="ghost" aria-label={zh ? '刷新手机依赖状态' : 'Refresh phone dependencies'} disabled={Boolean(busy)} onClick={() => void mutate()}><RefreshCw className="size-4" aria-hidden /></Button></div>
    <p className="text-xs text-fg-muted">{zh ? '检测和安装发生在 Gateway 所在机器。Electron 内置 Gateway 时安装在当前电脑，无需全局安装。' : 'Checks and installation run on the Gateway host, or this computer for Electron’s embedded Gateway. No global installation is needed.'}</p>
    {data?.installationEnabled === false ? <p className="text-xs text-fg-muted">{zh ? '托管安装已禁用，可在运行环境中启用；已有 ADB 仍可使用。' : 'Managed installation is disabled. Enable it in Runtime Tools, or use an existing ADB installation.'}</p> : null}
    {cloudOnly ? <div className="space-y-2 text-xs text-fg-muted"><p>{zh ? '阿里云连接无需本机 ADB；实时视频和持续触控需要 scrcpy server。' : 'Alibaba Cloud connections need no local ADB. Live video and continuous touch require scrcpy server.'}</p><button className="text-accent-fg hover:underline" aria-expanded={showLocal} onClick={() => setShowLocal(value => !value)}>{showLocal ? (zh ? '收起本机连接依赖' : 'Hide local connection dependencies') : (zh ? '连接本机手机？查看 ADB 依赖' : 'Connecting a local phone? Show ADB dependencies')}</button></div> : null}
    {error ? <p role="alert" className="text-sm text-danger">{zh ? '无法读取依赖状态，请刷新重试。' : 'Could not load dependency status. Refresh to retry.'}</p> : !data ? <Skeleton className="h-28 rounded-xl" /> : data.statuses.filter(item => !cloudOnly || showLocal || item.kind !== 'adb').map(item => {
      const name = item.kind === 'adb' ? 'ADB · Android Platform Tools' : 'scrcpy server';
      return <div key={item.kind} className="space-y-2 border-t border-edge-subtle pt-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium">{name}</p><p className="mt-1 text-xs text-fg-muted">{labels[item.state]}{item.version ? ` · ${item.version}` : ` · ${zh ? '托管版本' : 'Managed version'} ${item.requestedVersion}`}{item.source === 'system' ? (zh ? ' · 使用已有安装' : ' · Existing installation') : item.source === 'custom' ? (zh ? ' · 自定义路径' : ' · Custom path') : ''}</p></div>
          <Button disabled={Boolean(busy) || item.state === 'installing' || !item.canInstall} variant={item.state === 'ready' ? 'secondary' : 'primary'} onClick={() => void perform(item.kind, item.state === 'corrupted' || item.state === 'ready' && item.source === 'managed' ? 'repair' : 'install')}><Download className="size-4" aria-hidden />{busy === item.kind || item.state === 'installing' ? (zh ? '处理中…' : 'Working…') : item.state === 'ready' && item.source !== 'managed' ? (zh ? '安装托管副本' : 'Install managed copy') : item.state === 'ready' || item.state === 'corrupted' ? (zh ? '修复托管安装' : 'Repair managed copy') : (zh ? '安装' : 'Install')}</Button>
        </div>
        <p className="text-xs text-fg-muted">{item.kind === 'adb' ? (zh ? '仅连接本机 USB 手机或模拟器时需要；云手机无需安装。' : 'Required for local USB phones and emulators. Cloud phones do not need it.') : (zh ? '用于实时画面和跟手操作；缺失时仍可使用截图模式。' : 'Required for live video and continuous touch. Snapshots remain available without it.')}</p>
        <details className="text-xs text-fg-muted"><summary className="cursor-pointer py-1">{item.kind === 'adb' ? (zh ? '使用已有 ADB' : 'Use existing ADB') : (zh ? '导入已有 scrcpy server' : 'Import existing scrcpy server')}</summary>
          {item.path ? <p className="mt-2 break-all">{zh ? '当前文件：' : 'Current file: '}{item.path}</p> : null}
          <label className="mt-3 block space-y-2"><span>{item.kind === 'adb' ? (zh ? 'Gateway 上的 ADB 可执行文件绝对路径' : 'Absolute ADB executable path on Gateway') : (zh ? 'Gateway 上的 scrcpy server 文件绝对路径' : 'Absolute scrcpy server file path on Gateway')}</span><input aria-label={item.kind === 'adb' ? (zh ? '已有 ADB 路径' : 'Existing ADB path') : (zh ? '已有 scrcpy server 路径' : 'Existing scrcpy server path')} value={paths[item.kind]} disabled={Boolean(busy)} onChange={event => setPaths(current => ({ ...current, [item.kind]: event.target.value }))} className="w-full rounded-lg border border-edge bg-surface-base px-3 py-2 text-sm text-fg focus-visible:outline-2 focus-visible:outline-accent" /></label>
          <p className="mt-2">{item.kind === 'scrcpy' ? (zh ? `只接受固定版本 ${item.requestedVersion}，校验通过后复制到托管目录。` : `Only pinned version ${item.requestedVersion} is accepted and copied into managed storage after verification.`) : (zh ? '验证版本后保存路径；不会替换此文件或重启 ADB 服务。' : 'Checks the version and saves the path without replacing files or restarting ADB.')}</p>
          <Button className="mt-3" disabled={Boolean(busy) || !paths[item.kind].trim()} onClick={() => void perform(item.kind, 'existing')}>{zh ? '验证并使用' : 'Verify and use'}</Button>
          {item.kind === 'adb' ? <Button variant="ghost" className="ml-2 mt-3" disabled={Boolean(busy)} onClick={() => void perform('adb', 'detect')}>{zh ? '恢复自动检测' : 'Use automatic detection'}</Button> : null}
        </details>
      </div>;
    })}
    <div className="min-h-5 text-xs" aria-live="polite">{progress ? <p role="status" className="text-fg-muted">{phases[progress.phase] ?? progress.phase}{progress.downloadedBytes && progress.totalBytes ? ` · ${Math.min(100, Math.round(progress.downloadedBytes / progress.totalBytes * 100))}%` : ''}</p> : feedback ? <p role={failed ? 'alert' : 'status'} className={failed ? 'text-danger' : 'text-fg-muted'}>{feedback}</p> : null}</div>
    <a href="#/settings/runtimes" className="text-xs text-accent-fg hover:underline">{zh ? '管理下载代理与离线包' : 'Manage download proxy and offline packages'}</a>
  </section>;
}

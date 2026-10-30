import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchPhoneSettings, phoneRequest } from './phone-api';

export function HdcConnectionTools({ zh, onSaved }: { zh: boolean; onSaved(): void }) {
  const settings = useSWR('phone-settings', fetchPhoneSettings);
  const [sdkJar, setSdkJar] = useState('');
  const [devecoPath, setDevecoPath] = useState(''); const [javaHome, setJavaHome] = useState('');
  const [path, setPath] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { setPath(settings.data?.config.hdcPath ?? ''); }, [settings.data?.config.hdcPath]);
  useEffect(() => { setSdkJar(settings.data?.config.hdcVideo?.sdkJar ?? ''); setDevecoPath(settings.data?.config.hdcVideo?.devecoPath ?? ''); setJavaHome(settings.data?.config.hdcVideo?.javaHome ?? ''); }, [settings.data?.config.hdcVideo?.sdkJar, settings.data?.config.hdcVideo?.devecoPath, settings.data?.config.hdcVideo?.javaHome]);
  async function save() {
    setBusy(true); setError('');
    try {
      const latest = await fetchPhoneSettings();
      await phoneRequest('/settings', { ...latest.config, hdcPath: path.trim() || undefined, hdcVideo: { sdkJar: sdkJar.trim() || undefined, devecoPath: devecoPath.trim() || undefined, javaHome: javaHome.trim() || undefined } }, 'PATCH');
      await settings.mutate(); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3 rounded-xl border border-edge p-3">
    <p className="text-sm text-fg-muted">{zh ? '可一键安装独立连接组件，也可复用已有 HDC、JDK 和投屏库。以下路径仅供手动配置。' : 'Install standalone components above, or reuse an existing HDC, JDK and video library. These optional paths are for manual setup.'}</p>
    {!settings.data && !settings.error ? <Skeleton className="h-10 w-full" /> : <label className="block space-y-2 text-sm">{zh ? 'HDC 路径（可选）' : 'HDC path (optional)'}<input value={path} onChange={event => setPath(event.target.value)} placeholder={zh ? '自动查找' : 'Auto detect'} disabled={busy} className="min-h-10 w-full rounded-lg border border-edge bg-surface-base px-3 text-sm focus-visible:outline-2 focus-visible:outline-accent" /></label>}
    <p className="text-xs text-fg-muted">{settings.data?.hdcVideo?.available ? (zh ? '已找到投屏工具，连接时会验证设备兼容性。' : 'Video tools found; device compatibility is checked on connection.') : (zh ? '实时投屏需要兼容的 HOScrcpy 和 JDK 17+；依赖未就绪时使用截图。' : 'Live video requires compatible HOScrcpy and JDK 17+. Snapshots are used when unavailable.')}</p>
    <details className="text-sm"><summary className="cursor-pointer text-fg-muted">{zh ? '投屏工具路径（可选）' : 'Video tool paths (optional)'}</summary><div className="mt-3 space-y-3">
      <label className="block space-y-1.5">{zh ? 'DevEco Studio 安装目录' : 'DevEco Studio installation'}<input value={devecoPath} onChange={event => setDevecoPath(event.target.value)} disabled={busy} placeholder={zh ? '自动查找' : 'Auto detect'} className="min-h-10 w-full rounded-lg border border-edge bg-surface-base px-3 focus-visible:outline-2 focus-visible:outline-accent" /></label>
      <label className="block space-y-1.5">{zh ? 'HOScrcpy JAR（可选）' : 'HOScrcpy JAR (optional)'}<input value={sdkJar} onChange={event => setSdkJar(event.target.value)} disabled={busy} placeholder={zh ? '自动查找托管或已有库' : 'Detect managed or existing library'} className="min-h-10 w-full rounded-lg border border-edge bg-surface-base px-3 focus-visible:outline-2 focus-visible:outline-accent" /></label>
      <label className="block space-y-1.5">{zh ? 'JDK 根目录' : 'JDK home'}<input value={javaHome} onChange={event => setJavaHome(event.target.value)} disabled={busy} placeholder={zh ? '自动查找托管或已有 JDK' : 'Detect managed or existing JDK'} className="min-h-10 w-full rounded-lg border border-edge bg-surface-base px-3 focus-visible:outline-2 focus-visible:outline-accent" /></label>
    </div></details>
    <p className="text-xs text-fg-muted">{zh ? '修改工具路径会关闭当前手机连接，请保存后重新连接。' : 'Changing tool paths closes current phone connections. Reconnect after saving.'}</p>
    <Button disabled={busy || !settings.data} onClick={() => void save()}>{busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存连接工具路径' : 'Save connection tool path')}</Button>
    {(error || settings.error) && <p role="alert" className="text-sm text-danger">{error || String(settings.error)}</p>}
  </div>;
}

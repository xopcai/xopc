import { useEffect, useState } from 'react';
import { Loader2, Puzzle, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { installBrowserExtension, openBrowserExtension, type BrowserExtensionStatus } from '@/features/settings/browser/browser-control-api';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';
import type { BrowserRecordingAvailability } from './browser-automation-api';

export function BrowserRecordingConnectionGuide({ availability, endpointId, recordingBusy, onSelect, onRefresh, onStart, onClose }: {
  availability: BrowserRecordingAvailability;
  endpointId?: string;
  recordingBusy: boolean;
  onSelect: (id: string) => void;
  onRefresh: () => Promise<void>;
  onStart: () => void;
  onClose: () => void;
}) {
  const zh = useLocaleStore((state) => state.language) === 'zh';
  const navigate = useNavigate();
  const [status, setStatus] = useState<BrowserExtensionStatus>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [opened, setOpened] = useState(false);
  const ready = availability.endpoints.length > 0;
  const update = availability.state === 'update_required';
  useEffect(() => {
    let disposed = false;
    if (ready) { setLoading(false); return; }
    void fetchJson<BrowserExtensionStatus>(apiUrl('/api/browser/extension-status'))
      .then((value) => { if (!disposed) setStatus(value); })
      .catch((cause) => { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [ready]);
  const prepare = async () => {
    setBusy(true); setError('');
    try {
      if (update || !status?.artifacts?.installed || status.artifacts.needsRefresh) await installBrowserExtension(update || !!status?.artifacts?.needsRefresh);
      await openBrowserExtension(status?.artifacts?.installed ? 'chrome' : 'both');
      setOpened(true);
      await onRefresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const title = ready ? (zh ? '浏览器已连接' : 'Browser connected')
    : update ? (zh ? '更新扩展后即可录制' : 'Update the extension to record')
    : zh ? '连接 Chrome，录制你的操作' : 'Connect Chrome to record your actions';
  const body = ready ? (zh ? '在 Chrome 中切换到要录制的网页，然后开始录制。' : 'Switch to the website you want to record in Chrome, then start recording.')
    : update ? (zh ? '当前扩展还不支持录制。更新扩展文件后，在 Chrome 扩展页重新加载 xopc。' : 'Your connected extension does not support recording yet. Update its files, then reload xopc in Chrome Extensions.')
    : zh ? '录制需要 xopc Chrome 扩展。已有扩展请打开 xopc 侧栏，它会自动连接本机服务。' : 'Recording uses the xopc Chrome extension. If already installed, open its side panel to connect to your local Gateway.';
  return <section role="status" aria-live="polite" className="mb-4 shrink-0 rounded-xl border border-edge bg-surface-base p-4">
    <div className="flex items-start gap-3">
      <Puzzle className="mt-0.5 size-5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold text-fg">{title}</h2><p className="mt-1 text-sm leading-6 text-fg-muted">{body}</p></div>
      <button type="button" disabled={busy || recordingBusy} onClick={onClose} aria-label={zh ? '收起连接引导' : 'Close connection guide'} className="rounded p-1 text-fg-muted hover:bg-surface-hover"><X className="size-4" /></button>
    </div>
    {opened && !ready && <p className="mt-3 text-sm text-fg-muted">{status?.artifacts?.installed
      ? zh ? '重新加载后打开 xopc 侧栏。连接状态会自动更新。' : 'After reloading, open the xopc side panel. Connection status updates automatically.'
      : zh ? '在 Chrome 扩展页开启开发者模式，点击“加载已解压的扩展程序”，选择已打开的扩展目录，再打开 xopc 侧栏。连接状态会自动更新。' : 'Enable Developer mode in Chrome Extensions, choose Load unpacked and select the opened extension folder, then open the xopc side panel. Connection status updates automatically.'}</p>}
    {ready && availability.endpoints.length > 1 && <div className="mt-3 max-w-sm"><PopoverSelect value={endpointId ?? ''} ariaLabel={zh ? '选择录制浏览器' : 'Choose a browser to record'} placeholder={zh ? '选择浏览器' : 'Choose a browser'} allowEmpty={false}
      options={availability.endpoints.map((endpoint) => ({ value: endpoint.endpointId, label: endpoint.displayName }))} onChange={onSelect} /></div>}
    <div className="mt-3 flex flex-wrap gap-2">
      {ready ? <Button onClick={onStart} disabled={recordingBusy || !endpointId && availability.endpoints.length > 1}>{zh ? '开始录制' : 'Start recording'}</Button>
        : loading ? <Skeleton className="h-9 w-32 rounded-lg" />
        : status?.artifacts?.extensionDir ? <Button onClick={() => void prepare()} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />}{update ? zh ? '更新并打开扩展页' : 'Update and open extensions' : status.artifacts.installed ? zh ? '打开 Chrome 扩展页' : 'Open Chrome Extensions' : zh ? '安装 Chrome 扩展' : 'Install Chrome extension'}</Button>
        : <Button onClick={() => navigate('/settings/agent-browser')}>{zh ? '设置浏览器连接' : 'Set up browser connection'}</Button>}
      {!ready && <Button variant="secondary" disabled={busy} onClick={() => void onRefresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))}>{zh ? '检查连接' : 'Check connection'}</Button>}
    </div>
    {error && <p className="mt-2 text-sm text-danger" role="alert">{error}</p>}
  </section>;
}

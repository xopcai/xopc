import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { phoneRequest } from './phone-api';

type ConnectionTest = { token: string; endpoint: string; model: string; androidVersion: string; screenshot: string; expiresAt: number };
export function AliyunPhoneForm({ zh, onAdded }: { zh: boolean; onAdded(): void }) {
  const [name, setName] = useState(zh ? '阿里云手机' : 'Alibaba Cloud Phone');
  const [endpoint, setEndpoint] = useState('');
  const [file, setFile] = useState<File>();
  const [tested, setTested] = useState<ConnectionTest>();
  const [makeDefault, setMakeDefault] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const token = useRef<string | undefined>(undefined); const mounted = useRef(true);
  const discard = () => { const previous = token.current; token.current = undefined; setTested(undefined); if (previous) void phoneRequest(`/cloud/aliyun/tests/${previous}`, undefined, 'DELETE').catch(() => {}); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (token.current) void phoneRequest(`/cloud/aliyun/tests/${token.current}`, undefined, 'DELETE').catch(() => {}); }; }, []);
  const test = async () => {
    if (!file) return;
    discard(); setBusy(true); setError('');
    try {
      if (file.size > 16384) throw new Error(zh ? '私钥文件不能超过 16 KB' : 'Private key must be at most 16 KB');
      const result = await phoneRequest<ConnectionTest>('/cloud/aliyun/test', { endpoint: endpoint.trim(), privateKey: await file.text() });
      if (!mounted.current) { void phoneRequest(`/cloud/aliyun/tests/${result.token}`, undefined, 'DELETE').catch(() => {}); return; }
      token.current = result.token; setTested(result);
    } catch (e) { if (mounted.current) setError(String(e instanceof Error ? e.message : e)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const add = async () => {
    if (!tested) return; setBusy(true); setError('');
    try { await phoneRequest('/cloud/aliyun/add', { token: tested.token, name: name.trim(), makeDefault }); token.current = undefined; onAdded(); }
    catch (e) { if (mounted.current) setError(String(e instanceof Error ? e.message : e)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const input = 'mt-2 w-full rounded-xl border border-edge bg-surface-inset px-3 py-2 text-sm text-fg';
  return <div className="space-y-4">
    <p className="text-sm text-fg-muted">{zh ? '在阿里云控制台绑定密钥对并创建 ADB 连接，复制公网或 Gateway 可访问的内网地址。无需云账号 AccessKey。' : 'Bind a key pair and create an ADB connection in the Alibaba console. Use an address reachable from the Gateway. No cloud account AccessKey is needed.'}</p>
    <label className="block text-sm">{zh ? '手机名称' : 'Phone name'}<input className={input} value={name} maxLength={100} disabled={busy} onChange={event => setName(event.target.value)} /></label>
    <label className="block text-sm">{zh ? 'ADB 地址' : 'ADB address'}<input className={input} placeholder="203.0.113.10:10001" value={endpoint} disabled={busy} autoComplete="off" onChange={event => { discard(); setEndpoint(event.target.value); }} /></label>
    <label className="block text-sm">{zh ? '私钥文件（adbkey）' : 'Private key file (adbkey)'}<input className={input} type="file" disabled={busy} onChange={event => { discard(); setFile(event.target.files?.[0]); }} /></label>
    <p className="text-xs text-fg-muted">{zh ? '私钥仅提交到当前 Gateway，添加后保存在 Gateway 凭据目录，不会替换电脑现有 ADB 密钥。' : 'The key is sent only to this Gateway and saved in its credentials directory after adding. Existing host ADB keys stay unchanged.'}</p>
    <Button disabled={busy || !endpoint.trim() || !file} onClick={() => void test()}>{busy ? (zh ? '处理中…' : 'Working…') : zh ? '测试连接' : 'Test connection'}</Button>
    {error && <p role="alert" className="break-words text-sm text-danger">{error}</p>}
    {tested && <div className="space-y-3 rounded-xl border border-edge p-4"><p role="status" className="text-sm">{zh ? '连接成功' : 'Connected'} · {tested.model} · Android {tested.androidVersion}</p><img src={tested.screenshot} alt={zh ? '云手机当前画面' : 'Current cloud phone screen'} className="mx-auto max-h-64 rounded-lg object-contain" /><p className="text-xs text-fg-muted">{zh ? '添加后可在聊天中使用实时视频、接管操作和交还 Agent；视频不可用时使用截图。测试结果有效期为 10 分钟。默认只允许系统设置，添加后可在「管理」中调整。' : 'After adding, use live video, takeover and Agent handback in chat, with snapshots when video is unavailable. Test expires after 10 minutes. Settings is the initial allowed app; adjust it in Manage.'}</p><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={makeDefault} disabled={busy} onChange={event => setMakeDefault(event.target.checked)} />{zh ? '设为默认手机' : 'Set as default phone'}</label><Button variant="primary" disabled={busy || !name.trim() || tested.expiresAt <= Date.now()} onClick={() => void add()}>{zh ? '添加手机' : 'Add phone'}</Button></div>}
    <p className="text-xs text-fg-muted">{zh ? '移除连接只删除 xopc 的连接与私钥，不会销毁云手机，也不会关闭阿里云侧的 ADB 端口。' : 'Removing a connection deletes its xopc credentials. It does not destroy the cloud phone or close its cloud ADB endpoint.'}</p>
  </div>;
}

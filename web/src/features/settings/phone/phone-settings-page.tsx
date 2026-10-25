import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, FlaskConical, Play, Plus, RefreshCw, ShieldCheck, Smartphone, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { BetaBadge } from '@/components/ui/beta-badge';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { SettingsPageHeader } from '@/features/settings/settings-page-header';
import { fetchGlobalDefaults, updateGlobalDefaults } from '@/features/settings/global-defaults-api';
import { useLocaleStore } from '@/stores/locale-store';
import { PhoneDependenciesCard } from '@/features/settings/runtime-tools/phone-dependencies-card';

import { AddPhoneDialog } from './add-phone-dialog';
import { WirelessReconnectDialog } from './wireless-reconnect-dialog';
import { usePhoneWorkspaceStore } from '@/features/phone/phone-workspace-store';
import { PhoneAppPicker } from './phone-app-picker';
import { PhoneTextInput } from './phone-text-input';
import { PhoneModelConnection } from './phone-model-connection';
import { MOCK_MODEL, fetchPhoneDevices, fetchPhoneSettings, phoneRequest, type PhoneDevice, type PhoneReport } from './phone-api';

const fieldClass = 'w-full rounded-lg border border-edge bg-surface-base px-3 py-2.5 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
const deviceMenuItemClass = 'min-h-11 w-full cursor-default rounded-lg px-3 py-2 text-left text-sm outline-none data-[highlighted]:bg-surface-hover data-[highlighted]:ring-2 data-[highlighted]:ring-inset data-[highlighted]:ring-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50';
const panelClass = 'space-y-4 rounded-2xl border border-edge bg-surface-panel p-4 sm:p-5';

function DeviceForm({ device, serial, name, onSave, onClose, zh }: {
  device?: PhoneDevice; serial: string; name: string; zh: boolean;
  onSave(): Promise<void>; onClose(): void;
}) {
  const [displayName, setDisplayName] = useState(device?.name ?? name);
  const [appAccess, setAppAccess] = useState<'all' | 'selected'>(device?.appAccess ?? (device?.allowedApps.length ? 'selected' : 'all'));
  const [apps, setApps] = useState<string[]>(device?.allowedApps ?? []);
  const [textInput, setTextInput] = useState<'auto' | 'manual'>(device?.textInput ?? 'auto');
  const [enabled, setEnabled] = useState(device?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const input = { name: displayName, appAccess, allowedApps: appAccess === 'all' ? [] : apps, textInput, enabled };
      await phoneRequest(device ? `/devices/${device.id}` : '/devices', device ? input : { ...input, serial }, device ? 'PATCH' : 'POST');
      await onSave(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <Dialog.Root open onOpenChange={open => { if (!open && !busy) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/40" />
    <Dialog.Content className="fixed left-1/2 top-1/2 z-[81] flex h-[min(44rem,90dvh)] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay p-5 text-fg">
      <div className="flex shrink-0 items-start justify-between gap-3"><div>
        <Dialog.Title className="text-base font-semibold">{device ? (zh ? '管理手机' : 'Manage phone') : (zh ? '添加手机' : 'Add phone')}</Dialog.Title>
        <Dialog.Description className="mt-1 text-sm text-fg-muted">{zh ? '设备连接在 Gateway 所在电脑。修改权限会停止当前控制。' : 'This phone connects to the Gateway host. Changing access stops active control.'}</Dialog.Description>
      </div><Dialog.Close asChild><Button variant="ghost" disabled={busy} aria-label={zh ? '关闭' : 'Close'}><X className="size-4" /></Button></Dialog.Close></div>
      <form className="mt-5 flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <label className="block space-y-1.5 text-sm">{zh ? '名称' : 'Name'}<input className={fieldClass} value={displayName} maxLength={100} required onChange={event => setDisplayName(event.target.value)} /></label>
          <p className="break-all text-xs text-fg-muted">ADB: {serial}</p><p className="text-xs text-fg-muted">{zh ? '已启用 phone_use 工具的 Agent 可使用这台手机。' : 'Agents with the phone_use tool can use this phone.'}</p>
          <PhoneAppPicker deviceId={device?.id} serial={serial} mode={appAccess} selected={apps} onModeChange={setAppAccess} onSelectedChange={setApps} zh={zh} disabled={busy} />
          <PhoneTextInput deviceId={device?.id} value={textInput} onChange={setTextInput} disabled={busy} zh={zh} />
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />{zh ? '允许访问这台手机' : 'Enable access to this phone'}</label>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </div>
        <div className="mt-4 flex shrink-0 justify-end gap-2 border-t border-edge pt-4"><Button type="button" disabled={busy} onClick={onClose}>{zh ? '取消' : 'Cancel'}</Button><Button type="submit" variant="primary" disabled={busy || !displayName.trim() || (appAccess === 'selected' && !apps.length)}>{busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存手机' : 'Save phone')}</Button></div>
      </form>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

export function PhoneSettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const panelOpen = (name: string, fallback = false) => searchParams.has(name) ? searchParams.get(name) === '1' : fallback;
  const togglePanel = (name: string, open: boolean, fallback = false) => {
    if (open === panelOpen(name, fallback)) return;
    setSearchParams(previous => { const next = new URLSearchParams(previous); next.set(name, open ? '1' : '0'); return next; });
  };
  const zh = useLocaleStore(state => state.language) === 'zh';
  const settings = useSWR('phone-settings', fetchPhoneSettings);
  const devices = useSWR('phone-devices', fetchPhoneDevices, { refreshInterval: 15_000 });
  const defaults = useSWR('settings-agent-defaults', fetchGlobalDefaults);
  const savedModel = defaults.data?.defaults.models.phoneUse?.primary ?? '';
  const [model, setModel] = useState(savedModel);
  useEffect(() => { setModel(savedModel); }, [savedModel]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adding, setAdding] = useState(false);
  const [reconnecting, setReconnecting] = useState<PhoneDevice>();
  const [editing, setEditing] = useState<{ device?: PhoneDevice; serial: string; name: string }>();
  const [selected, setSelected] = useState('');
  const [goal, setGoal] = useState('');
  const [expectText, setExpectText] = useState('');
  const [sessionId, setSessionId] = useState(() => sessionStorage.getItem('phone-settings-session') ?? '');
  const session = useSWR(sessionId ? ['phone-session', sessionId] : null, () => phoneRequest<PhoneReport>(`/sessions/${sessionId}`), { refreshInterval: 1500 });
  const navigate = useNavigate();
  const [diagnostics, setDiagnostics] = useState<Record<string, { pending: boolean; text: string; error?: boolean }>>({});
  const report = session.data;
  const running = report?.status === 'running';
  const deviceId = selected || devices.data?.defaultDeviceId || '';
  const mock = savedModel === MOCK_MODEL;
  const perform = async (operation: () => Promise<unknown>, success?: string) => {
    setBusy(true); setError(''); setNotice('');
    try { await operation(); if (success) setNotice(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const saveModel = async (modelRef: string) => {
    const latest = await fetchGlobalDefaults(); const models = { ...latest.defaults.models };
    if (modelRef) models.phoneUse = { primary: modelRef, fallbacks: [] }; else delete models.phoneUse;
    const next = await updateGlobalDefaults({ ...latest.defaults, models }, { scope: 'models', expectedModels: latest.defaults.models });
    await defaults.mutate(next, false);
    setModel(modelRef);
  };
  const start = () => perform(async () => {
    if (sessionId && report && !['closed', 'cancelled', 'failed', 'outcome_unknown'].includes(report.status)) await phoneRequest(`/sessions/${sessionId}/execute`, { op: 'close' });
    const created = await phoneRequest<{ id: string; report: PhoneReport }>('/sessions', { deviceId, mode: 'control' });
    setSessionId(created.id); sessionStorage.setItem('phone-settings-session', created.id);
    await phoneRequest(`/sessions/${created.id}/execute`, { op: 'run', goal, ...(expectText ? { expectText } : {}), maxActions: 6 });
  });
  const control = (op: string) => perform(async () => { await phoneRequest(`/sessions/${sessionId}/execute`, { op }); await session.mutate(); });
  const diagnose = async (device: PhoneDevice) => {
    setDiagnostics(previous => ({ ...previous, [device.id]: { pending: true, text: zh ? '正在诊断…' : 'Checking…' } }));
    try {
      const result = await phoneRequest<{ state: string }>(`/devices/${device.id}/diagnostics`, {});
      const labels: Record<string, string> = zh ? { device: '已连接', disconnected: '未连接', unauthorized: '未授权调试', offline: '离线' } : { device: 'Connected', disconnected: 'Disconnected', unauthorized: 'Debugging not authorized', offline: 'Offline' };
      setDiagnostics(previous => ({ ...previous, [device.id]: { pending: false, text: `${zh ? '诊断结果' : 'Diagnostics'}：${labels[result.state] ?? result.state}` } }));
    } catch (cause) {
      setDiagnostics(previous => ({ ...previous, [device.id]: { pending: false, error: true, text: cause instanceof Error ? cause.message : String(cause) } }));
    }
  };
  const statusLabels: Record<string, string> = zh ? { ready: '就绪', running: '执行中', paused: '已暂停', needs_user: '等待人工处理', completed: '执行结束', cancelled: '已停止', closed: '已关闭', failed: '执行失败', outcome_unknown: '结果待核查' } : {};
  const cloudOnly = Boolean(devices.data?.devices.length && devices.data.devices.every(device => device.connection));

  return <SettingsPageFrame gap="gap-6" className="max-w-[48rem]">
    <SettingsPageHeader aiSetup="phone" title={<span className="inline-flex items-center gap-2">{zh ? '手机控制' : 'Phone Use'}<BetaBadge /></span>} subtitle={zh ? '让 AI 帮你操作 Android 手机。' : 'Let AI work with your Android phone.'} />


    {error && <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="text-sm text-fg-muted">{notice}</p>}
    {settings.error && <p role="alert" className="text-sm text-danger">{String(settings.error)}</p>}

    <section className={panelClass} aria-label={zh ? '手机控制设置' : 'Phone control settings'}>
      <div className="flex items-center justify-between gap-4"><div className="flex min-w-0 items-center gap-3"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface-inset text-fg-muted"><Smartphone className="size-6" aria-hidden /></span><div><h2 className="text-sm font-semibold">{zh ? '启用手机控制' : 'Enable Phone Use'}</h2><p className="mt-1 text-xs text-fg-muted">{zh ? '连接与操作在 Gateway 电脑上执行。' : 'Connects and runs on your Gateway computer.'}</p></div></div>
        {!settings.data ? <Skeleton className="h-8 w-12" /> : <button type="button" role="switch" aria-checked={settings.data.config.enabled} aria-label={zh ? '启用手机控制' : 'Enable Phone Use'} disabled={busy || running} className="touch-target flex shrink-0 items-center rounded-lg px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50" onClick={() => { const enabled = !settings.data!.config.enabled; void perform(async () => { await phoneRequest('/settings', { ...settings.data!.config, enabled }, 'PATCH'); await settings.mutate(); }); }}>
          <span className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors motion-reduce:transition-none ${settings.data.config.enabled ? 'bg-accent' : 'bg-fg-muted/30'}`}><span className={`size-5 rounded-full bg-white transition-transform motion-reduce:transition-none ${settings.data.config.enabled ? 'translate-x-5' : 'translate-x-0'}`} /></span>
        </button>}
      </div>

    </section>

    <section className={panelClass}>
      <label className="block space-y-2 text-sm"><span>{zh ? '默认执行方式' : 'Default execution strategy'}</span>
        {!settings.data ? <Skeleton className="h-10 w-full" /> : <Select aria-label={zh ? '默认执行方式' : 'Default execution strategy'} value={settings.data.config.executionMode ?? 'collaborative'} disabled={busy} onChange={event => { const executionMode = event.target.value; void perform(async () => { await phoneRequest('/settings', { ...settings.data!.config, executionMode }, 'PATCH'); await settings.mutate(); }); }}>
          <SelectOption value="collaborative">{zh ? '主 Agent 协作（默认）' : 'Main Agent collaboration (default)'}</SelectOption>
          <SelectOption value="direct">{zh ? '直接执行' : 'Direct execution'}</SelectOption>
        </Select>}
        <p className="text-xs text-fg-muted">{zh ? '协作：主 Agent 拆解目标并根据反馈继续。直接执行：手机模型自行规划完整手机任务。修改只影响新任务，聊天可覆盖。' : 'Collaboration: the main Agent plans small goals using feedback. Direct: the phone model plans the full phone task. Changes affect new tasks; chats can override.'}</p>
      </label>
    </section>

    <section aria-label={zh ? '手机模型配置' : 'Phone model configuration'} className={panelClass}>
      <h2 className="text-sm font-semibold">{zh ? '操作模型' : 'Phone model'}</h2>
      {settings.data && <label className="block space-y-2 text-sm"><span>{zh ? '连接保持时间' : 'Connection lifetime'}</span>
        <Select aria-label={zh ? '连接保持时间' : 'Connection lifetime'} value={String(settings.data.config.idleDisconnectMs ?? 0)} disabled={busy || running} onChange={event => { const idleDisconnectMs = Number(event.target.value); void perform(async () => { await phoneRequest('/settings', { ...settings.data!.config, idleDisconnectMs }, 'PATCH'); await settings.mutate(); }); }}>
          <SelectOption value="0">{zh ? '保持连接，直到手动断开' : 'Keep connected until disconnected'}</SelectOption>
          {[15, 30, 60].map(minutes => <SelectOption key={minutes} value={String(minutes * 60_000)}>{zh ? `闲置 ${minutes} 分钟后断开` : `Disconnect after ${minutes} idle minutes`}</SelectOption>)}
        </Select><p className="text-xs text-fg-muted">{zh ? '任务结束后保留连接；执行任务、人工操作和查看画面期间不计闲置。' : 'Tasks finish without disconnecting. Running tasks, manual control and viewing the screen do not count as idle.'}</p>
      </label>}
      {!defaults.data && !defaults.error ? <Skeleton className="h-20 w-full" /> : <PhoneModelConnection value={savedModel} onSelect={setModel} onSave={saveModel} zh={zh} disabled={busy || running || !defaults.data} />}
      {defaults.error && <p role="alert" className="text-sm text-danger">{String(defaults.error)}</p>}

      <div className="flex flex-wrap items-center gap-3"><Button variant="ghost" className="px-0 text-accent-fg hover:bg-transparent hover:underline" disabled={busy || !model || model === MOCK_MODEL} onClick={() => { void perform(async () => {
        const result = await phoneRequest<{ protocolValid: boolean; groundingVerified: boolean; mock: boolean }>('/models/diagnostics', { modelRef: model });
        setNotice(result.mock ? (zh ? '模拟适配器可用；此测试不验证真实模型。' : 'Mock adapter ready; this does not validate a real model.') : result.groundingVerified ? (zh ? '模型连接、动作协议和测试图定位通过；未操作真实手机。' : 'Connection, protocol and test-image grounding passed. No phone was operated.') : (zh ? '动作协议有效，但测试图定位未通过。' : 'Protocol valid, but test-image grounding did not pass.'));
      }); }}>{zh ? '测试模型连接' : 'Test model connection'}</Button></div>
      <details open={panelOpen('privacy')} onToggle={event => togglePanel('privacy', event.currentTarget.open)} className="group border-t border-edge-subtle pt-1 text-xs text-fg-muted">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden"><ShieldCheck className="size-4" aria-hidden />{zh ? '隐私与执行限制' : 'Privacy & execution limits'}<ChevronDown className="ml-auto size-4 group-open:rotate-180" aria-hidden /></summary>
        <div className="space-y-3 pb-2 leading-relaxed">
          <p className="text-xs leading-relaxed text-fg-muted">{zh ? '手机截图会发送给所选模型；页面摘要可能进入聊天模型。' : 'Phone screenshots go to the selected model; page summaries may reach the chat model.'}</p>      {settings.data && <p className="mt-2 text-xs text-fg-muted">{zh ? `每次小目标最多 12 步、${settings.data.config.maxOperationDurationMs / 1000} 秒活跃执行时间；会话限制` : `Each goal: up to 12 actions / ${settings.data.config.maxOperationDurationMs / 1000} active seconds. Session limits`}: {settings.data.config.maxActionsPerSession} {zh ? '动作' : 'actions'} · {settings.data.config.maxModelRequests} {zh ? '模型请求' : 'model requests'}</p>}
          <p>{zh ? '远程浏览器无法访问你本机的 USB 设备。' : 'A remote browser cannot access your local USB devices.'}</p></div>
      </details>
    </section>

    <section className="space-y-3" aria-label={zh ? '手机管理' : 'Phone management'}>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">{zh ? '手机管理' : 'Phones'}</h2><div className="flex items-center gap-2"><Button variant="ghost" disabled={busy} onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden />{zh ? '添加手机' : 'Add phone'}</Button><Button variant="ghost" disabled={busy || devices.isValidating} onClick={() => { void perform(() => devices.mutate()); }}><RefreshCw className="size-4" aria-hidden />{zh ? '刷新' : 'Refresh'}</Button></div></div>
      {!devices.data && !devices.error ? <Skeleton className="h-32 w-full rounded-xl" /> : <div className={panelClass}>
        {(devices.error || !cloudOnly && devices.data?.diagnostic) && <p role="alert" className="text-sm text-danger">{devices.data?.diagnostic ?? String(devices.error)} · {zh ? '检查 Gateway 电脑的 Android SDK 与 ADB。' : 'Check Android SDK and ADB on the Gateway host.'}</p>}
        {devices.data?.devices.map(device => <div key={device.id} className="border-b border-edge-subtle pb-4 last:border-b-0 last:pb-0">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:gap-4">
          <div className="flex min-w-0 flex-1 items-start gap-3"><Smartphone className="mt-0.5 size-5 shrink-0 text-fg-muted" /><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{device.name}{device.id === devices.data?.defaultDeviceId && <span className="ml-2 inline-block rounded-md bg-surface-inset px-2 py-0.5 text-xs font-normal text-fg-muted">{zh ? '默认' : 'Default'}</span>}</p><p className="mt-1 break-all text-xs text-fg-muted">{device.connection ? `${zh ? '阿里云' : 'Alibaba Cloud'} · ADB · ` : ''}{device.serial} · {device.enabled ? (device.connection ? (zh ? '已配置 · 按需连接' : 'Configured · Connects on demand') : ({ device: zh ? '已连接' : 'Connected', offline: zh ? '离线' : 'Offline', unauthorized: zh ? '待授权' : 'Unauthorized' }[devices.data?.discovery.find(item => item.serial === device.serial)?.state ?? ''] ?? (zh ? '未连接' : 'Disconnected'))) : (zh ? '已禁用' : 'Disabled')}</p></div></div>
          <div className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1 self-end sm:self-start">
            <Button variant="ghost" disabled={busy} onClick={() => setEditing({ device, serial: device.serial, name: device.name })}>{zh ? '管理' : 'Manage'}</Button>
            <Button variant="ghost" disabled={busy || !device.enabled} onClick={() => { void perform(async () => {
              await phoneRequest(`/devices/${device.id}/view`, {});
              window.dispatchEvent(new Event('phone-connections-changed'));
              usePhoneWorkspaceStore.getState().show(device.id);
            }); }}>{zh ? '查看屏幕' : 'View screen'}</Button>
            <Button variant="ghost" disabled={busy || !device.enabled} onClick={() => { void perform(async () => {
              const created = await phoneRequest<{ conversationId: string }>(`/devices/${device.id}/conversations`, {});
              window.dispatchEvent(new Event('session-created'));
              usePhoneWorkspaceStore.getState().hide();
              navigate(`/chat/${created.conversationId}`);
            }); }}>{zh ? '对话控制手机' : 'Control in chat'}</Button>
            <DropdownMenu.Root modal={false}>
              <DropdownMenu.Trigger asChild><Button variant="ghost" disabled={busy} aria-label={zh ? `${device.name}的更多操作` : `More actions for ${device.name}`}>{zh ? '更多' : 'More'}<ChevronDown className="size-3.5" aria-hidden /></Button></DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" sideOffset={6} collisionPadding={12} className="z-[90] min-w-40 max-w-[calc(100vw-1.5rem)] rounded-xl border border-edge bg-surface-overlay p-1 text-fg shadow-popover">
                  {device.wireless && <DropdownMenu.Item disabled={busy || !device.enabled} className={deviceMenuItemClass} onSelect={() => setReconnecting(device)}>{zh ? '重新连接' : 'Reconnect'}</DropdownMenu.Item>}
                  <DropdownMenu.Item disabled={busy || diagnostics[device.id]?.pending} className={deviceMenuItemClass} onSelect={() => { void diagnose(device); }}>{device.connection ? (zh ? '连接诊断' : 'Connect & diagnose') : (zh ? '诊断' : 'Diagnose')}</DropdownMenu.Item>
                  {device.id !== devices.data?.defaultDeviceId && <DropdownMenu.Item disabled={busy} className={deviceMenuItemClass} onSelect={() => { void perform(async () => { await phoneRequest(`/devices/${device.id}/default`, {}); await devices.mutate(); }); }}>{zh ? '设为默认' : 'Set default'}</DropdownMenu.Item>}
                  <DropdownMenu.Separator className="my-1 border-t border-edge-subtle" />
                  <DropdownMenu.Item disabled={busy} className={`${deviceMenuItemClass} text-danger`} onSelect={() => { void perform(async () => { await phoneRequest(`/devices/${device.id}`, undefined, 'DELETE'); await devices.mutate(); }); }}>{zh ? '移除连接' : 'Remove connection'}</DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
          </div>
          <p role="status" aria-live="polite" title={diagnostics[device.id]?.text} className={`h-5 truncate text-xs leading-5 ${diagnostics[device.id]?.error ? 'text-danger' : 'text-fg-muted'}`}>{diagnostics[device.id]?.text}</p>
        </div>)}
        {devices.data?.discovery.filter(found => !devices.data?.devices.some(device => device.serial === found.serial)).map(found => <div key={found.serial} className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm">{found.name}</p><p className="text-xs text-fg-muted">{found.emulator ? (zh ? 'Android 模拟器' : 'Android emulator') : 'Android'} · {found.state}</p></div><Button disabled={busy || found.state !== 'device'} onClick={() => setEditing({ serial: found.serial, name: found.name })}>{zh ? '添加手机' : 'Add phone'}</Button></div>)}
        {!devices.data?.devices.length && !devices.data?.discovery.length && <p className="py-3 text-sm text-fg-muted">{zh ? '尚未发现设备。先启动 Android 模拟器，或通过 USB 连接手机并允许调试。' : 'No devices found. Start an Android emulator, or connect a phone over USB and authorize debugging.'}</p>}
      </div>}
    </section>

    <PhoneDependenciesCard expanded={panelOpen('components')} onExpandedChange={open => togglePanel('components', open)} cloudOnly={cloudOnly} onChanged={() => { void devices.mutate(); void settings.mutate(); }} />

    <details key={sessionId} open={panelOpen('test', Boolean(sessionId))} onToggle={event => togglePanel('test', event.currentTarget.open, Boolean(sessionId))} className="group rounded-2xl border border-edge bg-surface-panel" aria-label={zh ? '手机试运行' : 'Phone test run'}>
      <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 p-5 [&::-webkit-details-marker]:hidden"><FlaskConical className="size-5 text-fg-muted" aria-hidden /><h2 className="text-sm font-semibold">{zh ? '试运行' : 'Test run'}</h2><span className="ml-auto text-xs text-fg-muted">{zh ? '验证手机操作' : 'Try a task'}</span><ChevronDown className="size-4 shrink-0 text-fg-muted group-open:rotate-180" aria-hidden /></summary>
      <div className="space-y-4 border-t border-edge-subtle p-5">
      <Select aria-label={zh ? '测试手机' : 'Test phone'} value={deviceId} disabled={busy || running} onChange={event => setSelected(event.target.value)}><SelectOption value="">{zh ? '选择手机' : 'Choose phone'}</SelectOption>{devices.data?.devices.filter(device => device.enabled).map(device => <SelectOption key={device.id} value={device.id}>{device.name}</SelectOption>)}</Select>
      <div className="space-y-3"><label className="block space-y-1.5 text-sm">{zh ? '本次授权的小目标' : 'Authorized goal'}<textarea className={fieldClass} value={goal} maxLength={2000} onChange={event => setGoal(event.target.value)} /></label><label className="block space-y-1.5 text-sm">{zh ? '完成时应显示的文字（可选）' : 'Expected completion text (optional)'}<input className={fieldClass} value={expectText} maxLength={200} onChange={event => setExpectText(event.target.value)} /></label><p className="text-xs text-fg-muted">{zh ? '先手动打开允许的应用。模型说完成只表示执行结束，只有匹配界面证据才会显示验证通过。' : 'First open an allowed app manually. A model completion claim remains unverified until native UI evidence matches.'}</p></div>
      <Button variant="primary" disabled={busy || running || !settings.data?.config.enabled || !savedModel || mock || model !== savedModel || !deviceId || !goal.trim()} onClick={() => { void start(); }}><Play className="size-4" />{zh ? '开始试运行' : 'Start test run'}</Button>
      {session.error && <p role="alert" className="text-sm text-danger">{String(session.error)}</p>}
      {report && <div className="space-y-3 rounded-xl border border-edge bg-surface-inset p-4" aria-live="polite">
        <p className="text-sm font-medium">{report.deviceName} · {statusLabels[report.status] ?? report.status}</p>
        <p className="text-xs text-fg-muted">{report.actions} {zh ? '动作' : 'actions'} · {report.modelRequests} {zh ? '模型请求' : 'model requests'} · {report.verified ? (zh ? '界面条件已验证' : 'UI condition verified') : (zh ? '尚未验证完成' : 'Completion unverified')}</p>
        {report.message && <p className="text-sm text-fg-muted">{report.message}</p>}
        {(report.errorCode || report.stopReason) && <p className="break-all text-xs text-fg-muted">{report.errorCode ?? report.stopReason}</p>}
        <div className="flex flex-wrap gap-2"><Button disabled={busy || !running} onClick={() => { void control('pause'); }}>{zh ? '暂停' : 'Pause'}</Button><Button disabled={busy || !['paused', 'needs_user'].includes(report.status)} onClick={() => { void control('resume'); }}>{zh ? '恢复' : 'Resume'}</Button><Button disabled={busy || ['closed', 'cancelled'].includes(report.status)} onClick={() => { void control('cancel'); }}>{zh ? '停止' : 'Stop'}</Button><Button disabled={busy} onClick={() => { void control('close'); }}>{zh ? '释放手机' : 'Release phone'}</Button>{report.status === 'ready' && !report.mock && <Button disabled={busy} onClick={() => { void perform(async () => { await phoneRequest(`/sessions/${sessionId}/execute`, { op: 'run', goal, ...(expectText ? { expectText } : {}) }); await session.mutate(); }); }}>{zh ? '继续当前目标' : 'Continue goal'}</Button>}</div>
        {report.facts?.length ? <details><summary className="cursor-pointer text-xs text-fg-muted">{zh ? '本次观察到的界面文字' : 'Observed UI text'}</summary><ul className="mt-2 max-h-52 space-y-1 overflow-auto text-xs text-fg-muted">{report.facts.map((fact, index) => <li key={index} className="break-words">{fact}</li>)}</ul></details> : null}
      </div>}
      </div>
    </details>

    {adding && <AddPhoneDialog onAdded={() => { void devices.mutate(); }} zh={zh} onClose={() => setAdding(false)} onSelect={device => { setAdding(false); setEditing({ serial: device.serial, name: device.name }); }} />}
    {reconnecting && <WirelessReconnectDialog device={reconnecting} zh={zh} onClose={() => setReconnecting(undefined)} onConnected={async () => { await devices.mutate(); }} />}
    {editing && settings.data && <DeviceForm {...editing} zh={zh} onSave={async () => { await devices.mutate(); }} onClose={() => setEditing(undefined)} />}
  </SettingsPageFrame>;
}

import * as Dialog from '@radix-ui/react-dialog';
import { FlaskConical, Play, RefreshCw, Smartphone, X } from 'lucide-react';
import { useEffect, useState } from 'react';
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
import { PhoneScreenDialog } from './phone-screen-dialog';
import { PhoneModelConnection } from './phone-model-connection';
import { MOCK_GOAL, MOCK_MODEL, fetchPhoneDevices, fetchPhoneSettings, phoneRequest, type PhoneDevice, type PhoneReport } from './phone-api';

const fieldClass = 'w-full rounded-lg border border-edge bg-surface-base px-3 py-2.5 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
const panelClass = 'space-y-4 rounded-2xl border border-edge bg-surface-panel p-4 sm:p-5';
const split = (value: string) => [...new Set(value.split(',').map(text => text.trim()).filter(Boolean))];

function DeviceForm({ device, serial, name, onSave, onClose, zh }: {
  device?: PhoneDevice; serial: string; name: string; zh: boolean;
  onSave(): Promise<void>; onClose(): void;
}) {
  const [displayName, setDisplayName] = useState(device?.name ?? name);
  const [apps, setApps] = useState(device?.allowedApps.join(', ') ?? 'com.android.settings');
  const [enabled, setEnabled] = useState(device?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const input = { name: displayName, allowedApps: split(apps), enabled };
      await phoneRequest(device ? `/devices/${device.id}` : '/devices', device ? input : { ...input, serial }, device ? 'PATCH' : 'POST');
      await onSave(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <Dialog.Root open onOpenChange={open => { if (!open && !busy) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/40" />
    <Dialog.Content className="fixed left-1/2 top-1/2 z-[81] flex h-[min(36rem,90dvh)] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay p-5 text-fg">
      <div className="flex shrink-0 items-start justify-between gap-3"><div>
        <Dialog.Title className="text-base font-semibold">{device ? (zh ? '管理手机' : 'Manage phone') : (zh ? '添加手机' : 'Add phone')}</Dialog.Title>
        <Dialog.Description className="mt-1 text-sm text-fg-muted">{zh ? '设备连接在 Gateway 所在电脑。修改权限会停止当前控制。' : 'This phone connects to the Gateway host. Changing access stops active control.'}</Dialog.Description>
      </div><Dialog.Close asChild><Button variant="ghost" disabled={busy} aria-label={zh ? '关闭' : 'Close'}><X className="size-4" /></Button></Dialog.Close></div>
      <form className="mt-5 flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <label className="block space-y-1.5 text-sm">{zh ? '名称' : 'Name'}<input className={fieldClass} value={displayName} maxLength={100} required onChange={event => setDisplayName(event.target.value)} /></label>
          <p className="break-all text-xs text-fg-muted">ADB: {serial}</p><p className="text-xs text-fg-muted">{zh ? '已启用 phone_use 工具的 Agent 可使用这台手机。' : 'Agents with the phone_use tool can use this phone.'}</p>
          <label className="block space-y-1.5 text-sm">{zh ? '允许的应用包名（逗号分隔）' : 'Allowed app packages (comma separated)'}<input className={fieldClass} value={apps} required onChange={event => setApps(event.target.value)} /></label>
          <p className="text-xs text-fg-muted">{zh ? '初次测试只需系统设置 com.android.settings。仅允许所列应用进入操作模型。' : 'Start with com.android.settings for testing. Only listed apps may be sent to the phone model.'}</p>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />{zh ? '允许访问这台手机' : 'Enable access to this phone'}</label>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </div>
        <div className="mt-4 flex shrink-0 justify-end gap-2 border-t border-edge pt-4"><Button type="button" disabled={busy} onClick={onClose}>{zh ? '取消' : 'Cancel'}</Button><Button type="submit" variant="primary" disabled={busy || !displayName.trim() || !apps.trim()}>{busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存手机' : 'Save phone')}</Button></div>
      </form>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

export function PhoneSettingsPage() {
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
  const [editing, setEditing] = useState<{ device?: PhoneDevice; serial: string; name: string }>();
  const [selected, setSelected] = useState('');
  const [goal, setGoal] = useState('');
  const [expectText, setExpectText] = useState('');
  const [sessionId, setSessionId] = useState(() => sessionStorage.getItem('phone-settings-session') ?? '');
  const session = useSWR(sessionId ? ['phone-session', sessionId] : null, () => phoneRequest<PhoneReport>(`/sessions/${sessionId}`), { refreshInterval: 1500 });
  const [previewDevice, setPreviewDevice] = useState<PhoneDevice>();
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
    const created = await phoneRequest<{ id: string; report: PhoneReport }>('/sessions', { deviceId, mode: 'control', ...(mock ? { appPackage: 'com.android.settings' } : {}) });
    setSessionId(created.id); sessionStorage.setItem('phone-settings-session', created.id);
    await phoneRequest(`/sessions/${created.id}/execute`, mock ? { op: 'run', scenario: 'settings-about', goal: MOCK_GOAL, maxActions: 8 } : { op: 'run', goal, ...(expectText ? { expectText } : {}), maxActions: 6 });
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

  return <SettingsPageFrame gap="gap-7">
    <SettingsPageHeader title={<span className="inline-flex items-center gap-2">{zh ? '手机控制' : 'Phone Use'}<BetaBadge /></span>} subtitle={zh ? '连接 Android 手机或模拟器，配置独立的手机操作模型。' : 'Connect an Android phone or emulator and choose a dedicated phone model.'} />
    {error && <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="text-sm text-fg-muted">{notice}</p>}
    {settings.error && <p role="alert" className="text-sm text-danger">{String(settings.error)}</p>}

    <section className={panelClass} aria-label={zh ? '手机控制设置' : 'Phone control settings'}>
      <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">{zh ? '启用手机控制' : 'Enable Phone Use'}</h2><p className="mt-1 text-xs text-fg-muted">{zh ? '执行位置：Gateway 所在电脑。远程浏览器不会连接你本机的 USB。' : 'Runs on the Gateway host. A remote browser cannot access your local USB devices.'}</p></div>
        {!settings.data ? <Skeleton className="h-8 w-12" /> : <input type="checkbox" role="switch" aria-checked={settings.data.config.enabled} aria-label={zh ? '启用手机控制' : 'Enable Phone Use'} className="size-5 shrink-0 accent-accent" checked={settings.data.config.enabled} disabled={busy || running} onChange={event => { const enabled = event.target.checked; void perform(async () => { await phoneRequest('/settings', { ...settings.data!.config, enabled }, 'PATCH'); await settings.mutate(); }); }} />}
      </div>
      {settings.data && <details className="text-sm"><summary className="cursor-pointer text-fg-muted">{zh ? '执行限制' : 'Execution limits'}</summary><p className="mt-2 text-xs text-fg-muted">{zh ? `每次小目标最多 12 步、${settings.data.config.maxOperationDurationMs / 1000} 秒活跃执行时间；会话限制` : `Each goal: up to 12 actions / ${settings.data.config.maxOperationDurationMs / 1000} active seconds. Session limits`}: {settings.data.config.maxActionsPerSession} {zh ? '动作' : 'actions'} · {settings.data.config.maxModelRequests} {zh ? '模型请求' : 'model requests'}</p></details>}
    </section>

    <section aria-label={zh ? '手机模型配置' : 'Phone model configuration'} className={panelClass}>
      <h2 className="text-sm font-semibold">{zh ? '手机操作模型' : 'Phone model'}</h2>
      {!defaults.data && !defaults.error ? <Skeleton className="h-44 w-full" /> : <PhoneModelConnection value={savedModel} onSelect={setModel} onSave={saveModel} zh={zh} disabled={busy || running || !defaults.data} />}
      {defaults.error && <p role="alert" className="text-sm text-danger">{String(defaults.error)}</p>}
      <p className="text-xs leading-relaxed text-fg-muted">{zh ? '手机截图会发送给所选模型；页面摘要可能进入聊天模型。' : 'Phone screenshots go to the selected model; page summaries may reach the chat model.'}</p>
      <div className="flex flex-wrap items-center gap-3"><Button disabled={busy || !model} onClick={() => { void perform(async () => {
        const result = await phoneRequest<{ protocolValid: boolean; groundingVerified: boolean; mock: boolean }>('/models/diagnostics', { modelRef: model });
        setNotice(result.mock ? (zh ? '模拟适配器可用；此测试不验证真实模型。' : 'Mock adapter ready; this does not validate a real model.') : result.groundingVerified ? (zh ? '模型连接、动作协议和测试图定位通过；未操作真实手机。' : 'Connection, protocol and test-image grounding passed. No phone was operated.') : (zh ? '动作协议有效，但测试图定位未通过。' : 'Protocol valid, but test-image grounding did not pass.'));
      }); }}>{zh ? '测试模型连接' : 'Test model connection'}</Button></div>
    </section>

    <PhoneDependenciesCard cloudOnly={cloudOnly} onChanged={() => { void devices.mutate(); void settings.mutate(); }} />

    <section className="space-y-3" aria-label={zh ? '手机管理' : 'Phone management'}>
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">{zh ? '手机管理' : 'Phones'}</h2><Button disabled={busy} onClick={() => setAdding(true)}>{zh ? '添加手机' : 'Add phone'}</Button><Button disabled={busy || devices.isValidating} onClick={() => { void perform(() => devices.mutate()); }}><RefreshCw className="size-4" />{zh ? '刷新设备' : 'Refresh devices'}</Button></div>
      {!devices.data && !devices.error ? <Skeleton className="h-32 w-full rounded-xl" /> : <div className={panelClass}>
        {(devices.error || !cloudOnly && devices.data?.diagnostic) && <p role="alert" className="text-sm text-danger">{devices.data?.diagnostic ?? String(devices.error)} · {zh ? '检查 Gateway 电脑的 Android SDK 与 ADB。' : 'Check Android SDK and ADB on the Gateway host.'}</p>}
        {devices.data?.devices.map(device => <div key={device.id} className="space-y-3 border-b border-edge-subtle pb-4 last:border-b-0 last:pb-0">
          <div className="flex items-start gap-3"><Smartphone className="mt-0.5 size-5 shrink-0 text-fg-muted" /><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{device.name}{device.id === devices.data?.defaultDeviceId && <span className="ml-2 text-xs text-fg-muted">{zh ? '默认' : 'Default'}</span>}</p><p className="mt-1 break-all text-xs text-fg-muted">{device.connection ? `${zh ? '阿里云' : 'Alibaba Cloud'} · ADB · ` : ''}{device.serial} · {device.enabled ? (device.connection ? (zh ? '已配置 · 按需连接' : 'Configured · Connects on demand') : devices.data?.discovery.find(item => item.serial === device.serial)?.state ?? (zh ? '离线' : 'Disconnected')) : (zh ? '已禁用' : 'Disabled')}</p></div></div>
          <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => setEditing({ device, serial: device.serial, name: device.name })}>{zh ? '管理' : 'Manage'}</Button><Button disabled={busy || running} onClick={() => { setPreviewDevice(device); }}>{zh ? '查看屏幕' : 'View screen'}</Button><Button disabled={busy || diagnostics[device.id]?.pending} onClick={() => { void diagnose(device); }}>{device.connection ? (zh ? '连接诊断' : 'Connect & diagnose') : (zh ? '诊断' : 'Diagnose')}</Button>{device.id !== devices.data?.defaultDeviceId && <Button disabled={busy} onClick={() => { void perform(async () => { await phoneRequest(`/devices/${device.id}/default`, {}); await devices.mutate(); }); }}>{zh ? '设为默认' : 'Set default'}</Button>}<Button variant="ghost" disabled={busy} onClick={() => { void perform(async () => { await phoneRequest(`/devices/${device.id}`, undefined, 'DELETE'); await devices.mutate(); }); }}>{zh ? '移除连接' : 'Remove connection'}</Button></div>
          <p role="status" aria-live="polite" title={diagnostics[device.id]?.text} className={`h-5 truncate text-xs leading-5 ${diagnostics[device.id]?.error ? 'text-danger' : 'text-fg-muted'}`}>{diagnostics[device.id]?.text}</p>
        </div>)}
        {devices.data?.discovery.filter(found => !devices.data?.devices.some(device => device.serial === found.serial)).map(found => <div key={found.serial} className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm">{found.name}</p><p className="text-xs text-fg-muted">{found.emulator ? (zh ? 'Android 模拟器' : 'Android emulator') : 'Android'} · {found.state}</p></div><Button disabled={busy || found.state !== 'device'} onClick={() => setEditing({ serial: found.serial, name: found.name })}>{zh ? '添加手机' : 'Add phone'}</Button></div>)}
        {!devices.data?.devices.length && !devices.data?.discovery.length && <p className="py-3 text-sm text-fg-muted">{zh ? '尚未发现设备。先启动 Android 模拟器，或通过 USB 连接手机并允许调试。' : 'No devices found. Start an Android emulator, or connect a phone over USB and authorize debugging.'}</p>}
      </div>}
    </section>

    <section className={panelClass} aria-label={zh ? '手机试运行' : 'Phone test run'}>
      <h2 className="flex items-center gap-2 text-sm font-semibold"><FlaskConical className="size-4" />{zh ? '试运行' : 'Test run'}</h2>
      <Select aria-label={zh ? '测试手机' : 'Test phone'} value={deviceId} disabled={busy || running} onChange={event => setSelected(event.target.value)}><SelectOption value="">{zh ? '选择手机' : 'Choose phone'}</SelectOption>{devices.data?.devices.filter(device => device.enabled).map(device => <SelectOption key={device.id} value={device.id}>{device.name}</SelectOption>)}</Select>
      {mock ? <p className="text-sm text-fg-muted">{zh ? '固定测试：打开系统设置，进入关于手机，并通过界面文字验证结果。这是模拟模型，不是 AI 推理。' : 'Fixed test: open Settings, navigate to About phone and verify native UI evidence. This is a scripted mock, not AI inference.'}</p> : <div className="space-y-3"><label className="block space-y-1.5 text-sm">{zh ? '本次授权的小目标' : 'Authorized goal'}<textarea className={fieldClass} value={goal} maxLength={2000} onChange={event => setGoal(event.target.value)} /></label><label className="block space-y-1.5 text-sm">{zh ? '完成时应显示的文字（可选）' : 'Expected completion text (optional)'}<input className={fieldClass} value={expectText} maxLength={200} onChange={event => setExpectText(event.target.value)} /></label><p className="text-xs text-fg-muted">{zh ? '先手动打开允许的应用。模型说完成只表示执行结束，只有匹配界面证据才会显示验证通过。' : 'First open an allowed app manually. A model completion claim remains unverified until native UI evidence matches.'}</p></div>}
      <Button variant="primary" disabled={busy || running || !settings.data?.config.enabled || !savedModel || model !== savedModel || !deviceId || (!mock && !goal.trim())} onClick={() => { void start(); }}><Play className="size-4" />{mock ? (zh ? '运行模拟测试' : 'Run mock test') : (zh ? '开始试运行' : 'Start test run')}</Button>
      {session.error && <p role="alert" className="text-sm text-danger">{String(session.error)}</p>}
      {report && <div className="space-y-3 rounded-xl border border-edge bg-surface-inset p-4" aria-live="polite">
        <p className="text-sm font-medium">{report.deviceName} · {statusLabels[report.status] ?? report.status}</p>
        <p className="text-xs text-fg-muted">{report.actions} {zh ? '动作' : 'actions'} · {report.modelRequests} {zh ? '模型请求' : 'model requests'} · {report.verified ? (zh ? '界面条件已验证' : 'UI condition verified') : (zh ? '尚未验证完成' : 'Completion unverified')}</p>
        {report.message && <p className="text-sm text-fg-muted">{report.message}</p>}
        {(report.errorCode || report.stopReason) && <p className="break-all text-xs text-fg-muted">{report.errorCode ?? report.stopReason}</p>}
        <div className="flex flex-wrap gap-2"><Button disabled={busy || !running} onClick={() => { void control('pause'); }}>{zh ? '暂停' : 'Pause'}</Button><Button disabled={busy || !['paused', 'needs_user'].includes(report.status)} onClick={() => { void control('resume'); }}>{zh ? '恢复' : 'Resume'}</Button><Button disabled={busy || ['closed', 'cancelled'].includes(report.status)} onClick={() => { void control('cancel'); }}>{zh ? '停止' : 'Stop'}</Button><Button disabled={busy} onClick={() => { void control('close'); }}>{zh ? '释放手机' : 'Release phone'}</Button>{report.status === 'ready' && <Button disabled={busy} onClick={() => { void perform(async () => { await phoneRequest(`/sessions/${sessionId}/execute`, mock ? { op: 'run', scenario: 'settings-about', goal: MOCK_GOAL, maxActions: 8 } : { op: 'run', goal, ...(expectText ? { expectText } : {}) }); await session.mutate(); }); }}>{zh ? '继续当前目标' : 'Continue goal'}</Button>}</div>
        {report.facts?.length ? <details><summary className="cursor-pointer text-xs text-fg-muted">{zh ? '本次观察到的界面文字' : 'Observed UI text'}</summary><ul className="mt-2 max-h-52 space-y-1 overflow-auto text-xs text-fg-muted">{report.facts.map((fact, index) => <li key={index} className="break-words">{fact}</li>)}</ul></details> : null}
      </div>}
    </section>
    {previewDevice && <PhoneScreenDialog device={previewDevice} sessionId={report?.deviceId === previewDevice.id && !['closed', 'cancelled', 'failed', 'outcome_unknown'].includes(report.status) ? sessionId : undefined} zh={zh} onClose={() => setPreviewDevice(undefined)} />}
    {adding && <AddPhoneDialog onAdded={() => { void devices.mutate(); }} zh={zh} onClose={() => setAdding(false)} onSelect={device => { setAdding(false); setEditing({ serial: device.serial, name: device.name }); }} />}
    {editing && settings.data && <DeviceForm {...editing} zh={zh} onSave={async () => { await devices.mutate(); }} onClose={() => setEditing(undefined)} />}
  </SettingsPageFrame>;
}

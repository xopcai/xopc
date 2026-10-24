import type { PhoneSetupView } from '@xopcai/gateway-contract';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { agentsAppDetailPath } from '@/features/settings/agents/agents-app-path';
import { PhoneDependenciesCard } from '@/features/settings/runtime-tools/phone-dependencies-card';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';

const action = (conversationId: string, action: string, args: Record<string, unknown> = {}) =>
  fetchJson<{ payload: PhoneSetupView }>(apiUrl('/api/phone/setup'), { method: 'POST', body: JSON.stringify({ conversationId, action, ...args }) });
function copyError(error: string, zh: boolean) {
  const messages = [
    ['MODEL_QUOTA_EXHAUSTED', '手机模型免费额度已用尽，测试控制已释放。请等待额度恢复或在设置选择其他已配置的兼容手机模型，无需重装 ADB 或重新授权手机。', 'Phone model free quota is exhausted; test control was released. Wait for quota reset or choose another configured compatible Phone model. No ADB reinstall or device reauthorization is needed.'],
    ['PERMISSION_REQUIRED', '请先在产品设置启用 Phone Use，并检查当前助手的工具权限。', 'Enable Phone Use and review this Agent’s tool permissions.'],
    ['MODEL_REQUIRED', '请选择已配置的真实手机操作模型；聊天模型不会被替换。', 'Choose a configured real Phone model; the chat model stays unchanged.'],
    ['ADB_REQUIRED', '本机连接需要可用的 ADB，请在依赖卡片安装或选择已有 ADB。', 'Install ADB below or select an existing compatible installation.'],
    ['DEVICE_OFFLINE', '手机尚未连通：本机请解锁并允许 USB 调试；云手机请检查密钥、地址和网络。', 'Unlock and authorize USB debugging, or check the cloud key, endpoint and network.'],
    ['DEVICE_REQUIRED', '请选择已启用且允许访问系统设置的手机。', 'Choose an enabled phone that allows the Settings app.'],
    ['LEASE_PENDING', '旧控制尚未确认释放，请稍后重新检查；不会创建另一个会话。', 'Previous control has not expired. Wait and recheck before starting another session.'],
  ];
  const item = messages.find(([key]) => error.includes(key));
  return item ? item[zh ? 1 : 2] : zh ? '配置或验收尚未完成，请检查进度；中断后先释放旧测试再重试。' : 'Setup is incomplete. Review progress and release an interrupted test before retrying.';
}
export function PhoneSetupPanel({ conversationId, disabled = false, onContinue }: {
  conversationId: string; disabled?: boolean; onContinue?: (prompt: string) => void;
}) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [deviceId, setDeviceId] = useState('');
  const status = useSWR(['phone-setup', conversationId], async () => {
    const response = await fetchJson<{ payload: { setup: PhoneSetupView | null } }>(apiUrl('/api/phone/setup'), {
      method: 'POST', body: JSON.stringify({ conversationId, action: 'inspect' }),
    }); return response.payload.setup;
  }, { refreshInterval: 5000, shouldRetryOnError: false });
  const setup = status.data;
  async function run(command: string, args: Record<string, unknown> = {}) {
    if (busy || disabled && command !== 'release' && command !== 'cancel') return;
    setBusy(true); setError('');
    try {
      const response = await action(conversationId, command, { ...(setup ? { setupId: setup.id } : {}), ...args });
      await status.mutate();
      if (command === 'begin_verification') onContinue?.(`Use configure-xopc for Phone Use setup ${response.payload.id}. Read references/phone/acceptance.md and phone_setup get. Perform only the approved real phone_use test, close its session, and read verification_report. Do not modify any other setting.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  if (status.isLoading) return <div className="mx-auto w-full max-w-2xl rounded-xl border border-edge p-4"><Skeleton className="h-5 w-40" /><Skeleton className="mt-3 h-24" /></div>;
  const readiness = setup?.readiness; const blocked = busy || disabled;
  const devices = readiness?.devices.filter(device => device.enabled && (!setup?.source || device.source === setup.source)) ?? [];
  const selectedDeviceId = deviceId || setup?.attempt?.deviceId || '';
  const chosen = devices.find(device => device.id === selectedDeviceId);
  const canTest = readiness?.enabled && readiness.toolAllowed && readiness.model.supported && readiness.model.configured && chosen?.settingsAllowed;
  const settingsPath = setup?.settingsPath ?? `/settings/phone-use?conversationId=${conversationId}`;
  return <section aria-label={zh ? 'Phone Use 配置' : 'Phone Use setup'} className="mx-auto w-full max-w-2xl space-y-3 rounded-xl border border-edge bg-surface-panel p-4">
    <h3 className="text-sm font-semibold">Phone Use · {setup?.state === 'completed' && !setup.stale ? (zh ? '基础验收通过' : 'Basic test passed') : zh ? '对话配置' : 'Guided setup'}</h3>
    <p className="text-sm text-fg-muted">{zh ? '把手机专用模型、依赖和设备连接逐步配好，再用一个小任务验证。配置和连接发生在 Gateway 所在机器。' : 'Configure a Phone model, dependencies and a device, then verify a small task. Connections originate from the Gateway host.'}</p>
    {(error || status.error || setup?.error) && <p role="alert" className="text-sm text-danger">{copyError(error || String(status.error ?? setup?.error), zh)}</p>}
    {!setup || setup.state === 'cancelled' ? <Button disabled={blocked} onClick={() => void run('start')}>{zh ? '开始配置手机' : 'Start Phone setup'}</Button> : <>
      <div className="flex flex-wrap gap-2"><Button variant={setup.source === 'local' ? 'primary' : 'secondary'} disabled={blocked || (setup.state === 'completed' || Boolean(setup.attempt && !setup.attempt.released))} onClick={() => void run('source', { source: 'local', expectedRevision: setup.revision })}>{zh ? '本机 Android 手机／模拟器' : 'Local Android / emulator'}</Button><Button variant={setup.source === 'aliyun' ? 'primary' : 'secondary'} disabled={blocked || (setup.state === 'completed' || Boolean(setup.attempt && !setup.attempt.released))} onClick={() => void run('source', { source: 'aliyun', expectedRevision: setup.revision })}>{zh ? '阿里云手机' : 'Alibaba Cloud phone'}</Button></div>
      {!readiness?.enabled && <Link className="block text-sm text-accent-fg" to={settingsPath}>{zh ? '先到手机设置开启 Phone Use' : 'Enable Phone Use in phone settings first'}</Link>}
      <ol className="list-inside list-decimal space-y-2 text-sm">
        <li>{zh ? '手机操作模型' : 'Phone action model'}：{readiness?.model.ref ?? (zh ? '尚未选择' : 'Not selected')} · {readiness?.model.configured && readiness.model.supported ? (zh ? '已配置，待实测' : 'Configured · real test required') : (zh ? '需要配置' : 'Configuration required')} <Link className="text-accent-fg" to={readiness?.model.source === 'agent' ? agentsAppDetailPath(setup.agentId) : settingsPath}>{zh ? '配置与测试模型' : 'Configure and test model'}</Link><p className="mt-1 text-xs text-fg-muted">{zh ? '手机模型和聊天模型独立；普通视觉模型不一定支持手机动作协议。' : 'Phone and chat models are separate. Vision support alone does not establish Phone compatibility.'}</p></li>
        <li>{zh ? '安装依赖' : 'Dependencies'}：{setup.source === 'aliyun' ? (zh ? '无需本机 ADB；视频和中文输入需要 scrcpy server。' : 'No local ADB needed; video and Unicode use scrcpy server.') : (zh ? 'ADB 连接本机手机；scrcpy server 提供视频和中文输入。' : 'ADB connects local phones; scrcpy server provides video and Unicode input.')}</li>
        <li><Link className="text-accent-fg" to={settingsPath}>{zh ? '添加或检查手机连接' : 'Add or check a phone'}</Link>{zh ? '；密钥只在安全页面上传，不要发到聊天。' : '; upload keys in the secure form, never chat.'}</li>
      </ol>
      {setup.source && !['verifying', 'completed'].includes(setup.state) && <PhoneDependenciesCard cloudOnly={setup.source === 'aliyun'} onChanged={() => void status.mutate()} />}
      {setup.source === 'local' && <p className="text-xs text-fg-muted">{zh ? '使用数据线连接并解锁手机，开启开发者选项和 USB 调试；在手机上核对并允许这台 Gateway 的调试请求。拒绝后可重新连接授权，无需清除数据。' : 'Connect a data cable, unlock Android and enable developer options / USB debugging. Review this Gateway’s authorization request on the phone. Reconnect to retry a refusal; no data reset is required.'}</p>}
      {setup.source === 'aliyun' && <details className="text-sm"><summary className="cursor-pointer">{zh ? '还没有云手机？购买与准备' : 'Need a cloud phone? Purchase and prepare'}</summary><p className="mt-2 text-xs text-fg-muted">{zh ? '先确认实例提供可从 Gateway 访问的 ADB 地址，并支持匹配的私钥。由你在阿里云确认规格、地域、网络、费用和自动续费；xopc 不代付。已有实例优先复用，移除 xopc 连接不会停止云端计费。' : 'Confirm an ADB endpoint reachable from Gateway and its matching private key before purchase. Review specifications, region, network, cost and renewal yourself. Reuse an existing instance; removing an xopc connection does not stop cloud charges.'}</p><a className="mt-2 block text-accent-fg" target="_blank" rel="noopener noreferrer" href="https://help.aliyun.com/zh/ecp/quickly-experience-and-create-cloud-phone-jvs-mobile">{zh ? '阿里云官方购买与创建指引' : 'Official Alibaba purchase guide'}</a><a className="block text-accent-fg" target="_blank" rel="noopener noreferrer" href="https://help.aliyun.com/zh/ecp/how-to-connect-cloud-phone-via-adb">{zh ? 'ADB 网络与密钥配置' : 'ADB networking and key setup'}</a></details>}
      {!readiness?.toolAllowed && <Link className="block text-sm text-accent-fg" to={agentsAppDetailPath(setup.agentId)}>{zh ? '查看助手工具权限，修改后返回原对话' : 'Review Agent permissions, then return to this chat'}</Link>}
      {setup.state !== 'completed' && <><PopoverSelect value={selectedDeviceId} disabled={blocked || Boolean(setup.attempt && !setup.attempt.released)} onChange={setDeviceId} options={devices.map(device => ({ value: device.id, label: device.name }))} placeholder={zh ? '明确选择用于验收的手机' : 'Choose the phone to verify'} allowEmpty={false} /><p className="text-xs text-fg-muted">{zh ? '开始后会向所选手机模型发送截图，可能产生模型费用；仅导航系统设置并读取 Android 版本，不改设置。请先退出密码、验证码或支付页面。' : 'The test sends screenshots to the selected Phone model and may incur model charges. It navigates Settings to read Android version without changing settings. Leave password, verification-code or payment screens first.'}</p></>}
      {setup.stale && <p className="text-sm text-warning">{zh ? '模型、设备或权限已变化，旧验收已失效。请释放旧测试后重新开始。' : 'Model, device or policy changed. Release the old test and verify again.'}</p>}
      <div className="flex flex-wrap gap-2 text-xs text-fg-muted">{(['read', 'operated', 'verified', 'released'] as const).map((check, i) => <span key={check}>{setup.checks[check] ? '✓' : '○'} {zh ? ['读取', '导航操作', '界面验证', '控制释放'][i] : ['Read', 'Navigation', 'UI evidence', 'Control released'][i]}</span>)}</div>
      <div className="flex flex-wrap gap-2">
        {setup.state === 'completed' && <Button disabled={blocked} onClick={() => void run('start')}>{zh ? '配置另一部手机／重新验收' : 'Configure another phone / retest'}</Button>}
        {(!setup.attempt || setup.attempt.released) && setup.state !== 'completed' && <Button disabled={blocked || !canTest} onClick={() => void run('begin_verification', { deviceId: selectedDeviceId, expectedRevision: setup.revision })}>{zh ? '授权并开始安全验收' : 'Approve and start safe test'}</Button>}
        <Button variant="secondary" disabled={busy} onClick={() => void status.mutate()}>{zh ? '重新检查' : 'Recheck'}</Button>
        {setup.attempt && !setup.attempt.released && <Button variant="secondary" disabled={busy} onClick={() => void run('release')}>{zh ? '释放测试手机' : 'Release test phone'}</Button>}
        {setup.state === 'verifying' && onContinue && <Button disabled={blocked} onClick={() => onContinue(`Use configure-xopc to recover Phone setup ${setup.id}. Read phone_setup get and phone acceptance; inspect status, continue only the remaining authorized test, close and verify release.`)}>{zh ? '在原对话继续验收' : 'Continue test in this chat'}</Button>}
        {setup.state !== 'completed' && <Button variant="ghost" disabled={busy} onClick={() => void run('cancel')}>{zh ? '取消配置' : 'Cancel setup'}</Button>}
      </div>
      {!onContinue && setup.state === 'verifying' && <Link className="block text-sm text-accent-fg" to={`/chat/${conversationId}?scene=configure-phone&skill=configure-xopc&draft=${encodeURIComponent(`Use configure-xopc to verify Phone setup ${setup.id}, close its session and report actual evidence.`)}&autoSend=1`}>{zh ? '返回原对话完成验收' : 'Return to original chat to verify'}</Link>}
      {setup.state === 'completed' && !setup.stale && <p className="text-sm">{zh ? '基础控制已通过并释放。现在可在这个对话提出一个小任务；登录、业务效果和其他应用权限仍需分别确认。' : 'Basic control passed and was released. Ask for a small task in this chat; login, business outcomes and other app access still need separate checks.'}</p>}
    </>}
  </section>;
}

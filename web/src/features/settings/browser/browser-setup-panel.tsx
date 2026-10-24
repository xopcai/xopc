import type { BrowserSetupView } from '@xopcai/gateway-contract';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { agentsAppDetailPath } from '@/features/settings/agents/agents-app-path';
import { Button } from '@/components/ui/button';
import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';

export async function browserSetupAction(conversationId: string, action: string, args: Record<string, unknown> = {}) {
  return fetchJson<{ ok: true; payload: BrowserSetupView }>(apiUrl('/api/browser/setup'), {
    method: 'POST', body: JSON.stringify({ conversationId, action, ...args }),
  });
}

function errorCopy(message: string, zh: boolean) {
  const entries = [
    ['LOCAL_OWNER_REQUIRED', '请在运行 Gateway 的电脑打开配置；连接另一台电脑请使用设备配对。', 'Open setup on the Gateway computer, or use device pairing for another computer.'],
    ['CONFIG_CHANGED', '浏览器配置已被修改，请保留最新设置并重新开始配置。', 'Browser settings changed. Keep the latest settings and start a new plan.'],
    ['AGENT_BROWSER_DENIED', '这个助手尚未获准使用浏览器。请检查 Agent 的工具权限，再返回验收。', 'This Agent cannot use the browser yet. Check its tool permissions before testing.'],
    ['BROWSER_BUSY', '已有浏览器会话或其他任务正在使用，请先结束它们，再重试切换。', 'Existing browser sessions or other runs are active. Finish them before switching.'],
    ['PREPARE_FAILED', '扩展文件准备未完成。可以重试，或让助手检查本机安装问题。', 'Extension preparation did not finish. Retry or ask your assistant to diagnose installation.'],
    ['INSTALLATION_REQUIRED', '需要准备或修复本机扩展文件。', 'Prepare or repair the local extension files.'],
    ['TAB_ALREADY_ATTACHED', '当前对话已连接其他标签页，请先释放它，再开始独立演示。', 'Release the currently attached tab before starting the separate demo.'],
    ['CONTROL_RELEASE_REQUIRED', '请先释放演示控制，再重新配置。', 'Release demo control before starting another setup.'],
    ['ENDPOINT_OFFLINE', '选定的 Chrome 已断开，请重新连接后再试。', 'The selected Chrome is offline. Reconnect it and try again.'],
    ['VERIFICATION_', '演示尚未全部通过，请先释放控制，再让助手继续诊断或重新验收。', 'The demo did not fully pass. Release control, then diagnose or test again.'],
    ['BROWSER_CONTROL_REVOKED', '你已在 Chrome 中停止控制。先释放演示，再到 xopc 扩展点击“恢复网页控制”，返回这个对话重新验收。', 'You stopped control in Chrome. Release the demo, choose Resume browser control in the xopc extension, then return to this chat to test again.'],
    ['BROWSER_ACTION_FAILED', '网页操作未完成，请先释放演示控制。', 'The browser action did not finish. Release demo control first.'],
  ];
  const entry = entries.find(([code]) => message.includes(code));
  return entry ? entry[zh ? 1 : 2] : zh ? '操作暂未完成，可以重试或让助手继续诊断。' : 'The action did not finish. Retry or ask your assistant to diagnose it.';
}

export function BrowserSetupPanel({ conversationId, requested = false, onContinue, disabled = false }: {
  conversationId: string; requested?: boolean; disabled?: boolean; onContinue?: (prompt: string) => void;
}) {
  const zh = useLocaleStore(s => s.language) === 'zh';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [endpoint, setEndpoint] = useState('');
  const status = useSWR(['browser-setup', conversationId], async () => {
    const result = await fetchJson<{ payload: { setup: BrowserSetupView | null } }>(apiUrl('/api/browser/setup'), {
      method: 'POST', body: JSON.stringify({ conversationId, action: 'inspect' }),
    });
    return result.payload.setup;
  }, { shouldRetryOnError: false, refreshInterval: latest => latest && !['completed', 'cancelled'].includes(latest.state) ? 3000 : 0, revalidateOnFocus: true });
  const setup = status.data;
  const displayError = error ?? (setup?.toolPermission === 'denied' ? 'AGENT_BROWSER_DENIED' : null);
  useEffect(() => {
    if (!setup || setup.state !== 'waiting_extension' || !setup.endpoints.length || busy) return;
    void browserSetupAction(conversationId, 'recheck', { setupId: setup.id }).then(() => status.mutate()).catch(() => {});
  }, [setup?.state, setup?.endpoints.length, setup?.id, conversationId, busy, status.mutate]);
  if (!setup && !requested) return null;
  if (status.isLoading) return <div className="mx-auto w-full max-w-2xl rounded-xl border border-edge p-4"><Skeleton className="h-5 w-48" /><Skeleton className="mt-3 h-16" /></div>;

  const run = async (action: string, args: Record<string, unknown> = {}) => {
    if (busy || (disabled && action !== 'cancel' && action !== 'release')) return;
    setBusy(true); setError(null);
    try {
      const result = await browserSetupAction(conversationId, action, { ...(setup ? { setupId: setup.id } : {}), ...args });
      if (action === 'approve') await browserSetupAction(conversationId, 'prepare', { setupId: result.payload.id });
      await status.mutate();
      if (action === 'approve' || action === 'prepare') window.dispatchEvent(new Event('config-reload'));
      if (action === 'begin_verification') onContinue?.(`Use the configure-xopc skill to verify Browser setup ${result.payload.id}. Read the browser acceptance reference and setup get, then perform the real browser_use test and close its session. Do not modify other settings.`);
      if (!disabled && action === 'cancel' && setup?.attempt && !setup.attempt.released) onContinue?.(`Browser setup ${setup.id} is cancelled. Use browser_use close to release only its verification session, then report cleanup. Do not continue the original task.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const blocked = busy || disabled;
  const labels = zh ? {
    plan_ready: '准备配置', preparing: '正在准备文件', waiting_extension: '等待 Chrome 扩展连接', ready_for_verification: '已连接，等待验收', verifying: '正在验收', needs_attention: '需要处理', completed: '基础交互验收通过', cancelled: '配置已取消',
  } : { plan_ready: 'Review setup', preparing: 'Preparing files', waiting_extension: 'Waiting for Chrome', ready_for_verification: 'Connected · test pending', verifying: 'Verifying', needs_attention: 'Needs attention', completed: 'Interaction test passed', cancelled: 'Setup cancelled' };

  return <section aria-label={zh ? 'Browser Use 配置' : 'Browser Use setup'} className="mx-auto w-full max-w-2xl rounded-xl border border-edge bg-surface-panel p-4">
    <h3 className="text-sm font-semibold text-fg">Browser Use · {setup ? setup.stale ? (zh ? '配置已变化，需重新验收' : 'Settings changed · retest required') : labels[setup.state] : zh ? '对话配置' : 'Guided setup'}</h3>
    <p className="mt-2 text-sm text-fg-muted">{zh ? '连接 Chrome 后，可让助手阅读、点击和输入网页。配置会影响这个 Gateway 的共享浏览器设置，具体任务仍受 Agent 权限约束。' : 'Connect Chrome so your assistant can read, click and type on web pages. Browser settings are shared across this Gateway; Agent permissions still apply.'}</p>
    {setup?.currentDriverKind && setup.currentDriverKind !== 'extension' && setup.state === 'plan_ready' && <p className="mt-2 text-sm text-warning">{zh ? `当前连接方式为 ${setup.currentDriverKind}。批准后会将共享浏览器连接切换为 Chrome 扩展。` : `Current connection: ${setup.currentDriverKind}. Approval switches the shared browser connection to the Chrome extension.`}</p>}
    {(displayError || status.error) && <p role="alert" className="mt-2 text-sm text-danger">{errorCopy(displayError ?? String(status.error), zh)}</p>}
    {(displayError ?? setup?.error)?.includes('AGENT_BROWSER_DENIED') && setup && <Link className="mt-2 block text-sm text-accent-fg" to={agentsAppDetailPath(setup.agentId)}>{zh ? '查看助手工具权限，修改后返回此对话继续' : 'Review Agent tool permissions, then return to this chat'}</Link>}
    {setup?.error && <p role="status" className="mt-2 text-sm text-warning">{errorCopy(setup.error, zh)}</p>}
    {(setup?.error || displayError || status.error) && <details className="mt-2 text-xs text-fg-muted"><summary className="cursor-pointer">{zh ? '诊断信息' : 'Diagnostic details'}</summary><p className="mt-1 break-words">{setup?.error ?? displayError ?? String(status.error)}</p></details>}
    {setup?.stale && <p className="mt-2 text-sm text-warning">{zh ? '浏览器配置已变化，旧验收不再代表当前配置。请重新开始。' : 'Browser settings changed. Previous evidence is stale; start a new plan.'}</p>}
    {setup && setup.state === 'waiting_extension' && <ol className="mt-3 list-inside list-decimal space-y-1 text-sm text-fg-muted">
      <li>{zh ? '打开 Chrome 扩展页，启用开发者模式。' : 'Open Chrome Extensions and enable Developer mode.'}</li>
      <li>{zh ? '选择“加载已解压的扩展程序”，选择准备好的扩展目录。' : 'Choose Load unpacked and select the prepared extension directory.'}</li>
      <li>{zh ? '打开 xopc 扩展侧栏，等待连接，然后选择下面的 Chrome。' : 'Open the xopc side panel, wait for connection, then choose Chrome below.'}</li>
    </ol>}
    {setup?.state === 'ready_for_verification' && <div className="mt-3 space-y-2"><PopoverSelect value={endpoint} options={setup.endpoints.map(e => ({ value: e.endpointId, label: `${e.displayName} · ${e.endpointId.slice(0, 12)}` }))} placeholder={zh ? '选择用于验收的 Chrome' : 'Choose Chrome to test'} onChange={setEndpoint} allowEmpty={false} /><p className="text-xs text-fg-muted">{zh ? '将打开独立演示窗口，验证读取、点击和输入；会使用正常模型调用。仅本次演示页可访问本机 Gateway，不扩大其他网页权限。' : 'Opens a separate demo window to verify reading, clicking and typing, using normal model calls. Only this demo may access the local Gateway; other page permissions stay unchanged.'}</p></div>}
    {setup?.attempt && <div className="mt-3 flex flex-wrap gap-3 text-xs text-fg-muted">{(['read', 'clicked', 'filled', 'released'] as const).map((key, i) => <span key={key}>{setup.checks[key] ? '✓' : '○'} {zh ? ['读取', '点击', '输入', '控制释放'][i] : ['Read', 'Click', 'Type', 'Control released'][i]}</span>)}</div>}
    {setup?.state === 'completed' && !setup.stale && <p className="mt-3 text-sm text-fg">{zh ? '打开一个网页，将它交给当前对话，再说“帮我总结这个页面”。具体网站可能仍需登录。' : 'Attach a page to this conversation and ask for a summary. Individual sites may require login.'}</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      {(!setup || setup.state === 'cancelled' || setup.state === 'completed' || setup.stale) && <Button disabled={blocked} onClick={() => void run('start')}>{zh ? '开始配置' : 'Start setup'}</Button>}
      {setup && !setup.approvedBy && !setup.stale && setup.state === 'plan_ready' && <Button disabled={blocked} onClick={() => void run('approve', { expectedRevision: setup.revision })}>{zh ? '启用 Chrome 连接并准备文件' : 'Enable Chrome and prepare files'}</Button>}
      {setup?.approvedBy && setup.state === 'needs_attention' && !setup.stale && (!setup.attempt || setup.attempt.released) && <Button disabled={blocked} onClick={() => void run('prepare')}>{zh ? '重新检查并准备' : 'Repair preparation'}</Button>}
      {setup?.approvedBy && ['waiting_extension', 'ready_for_verification'].includes(setup.state) && <>
        <Button variant="secondary" disabled={blocked} onClick={() => void run('open', { open: 'chrome' })}>{zh ? '打开扩展页' : 'Open extensions'}</Button>
        <Button variant="secondary" disabled={blocked} onClick={() => void run('open', { open: 'folder' })}>{zh ? '打开扩展目录' : 'Open folder'}</Button>
        <Button variant="ghost" disabled={blocked} onClick={() => void run('recheck')}>{zh ? '检查连接' : 'Check connection'}</Button>
      </>}
      {setup?.state === 'ready_for_verification' && <Button disabled={blocked || !endpoint} onClick={() => void run('begin_verification', { endpointId: endpoint, expectedRevision: setup.revision })}>{zh ? '开始演示验收' : 'Start demo test'}</Button>}
      {setup?.state === 'verifying' && onContinue && <Button disabled={blocked} onClick={() => onContinue(`Use configure-xopc to continue Browser setup ${setup.id}. Read setup get and the acceptance reference; perform only the remaining verification and release its session.`)}>{zh ? '继续验收' : 'Continue test'}</Button>}
      {setup && !['completed', 'cancelled'].includes(setup.state) && <Button variant="ghost" disabled={busy} onClick={() => void run('cancel')}>{zh ? '取消配置' : 'Cancel setup'}</Button>}
      <Link className="self-center text-xs text-accent-fg hover:underline" to="/settings/devices">{zh ? '另一台电脑？前往设备配对' : 'Another computer? Device pairing'}</Link>
    </div>
    {setup?.attempt && !setup.attempt.released && ['verifying', 'needs_attention', 'cancelled'].includes(setup.state) && <Button className="mt-2" variant="secondary" disabled={busy} onClick={() => void run('release')}>{zh ? '释放演示控制' : 'Release demo control'}</Button>}
    {setup?.state === 'verifying' && !onContinue && <Link className="mt-2 block text-sm text-accent-fg" to={`/chat/${conversationId}?skill=configure-xopc&draft=${encodeURIComponent(`Continue verification for Browser setup ${setup.id}.`)}&autoSend=1`}>{zh ? '返回对话完成验收' : 'Continue verification in chat'}</Link>}
  </section>;
}

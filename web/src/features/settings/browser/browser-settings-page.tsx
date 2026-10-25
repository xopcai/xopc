import { Eye, Gauge, Globe, Info, LockKeyhole, Settings2 } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

import { NumberInput } from '@/components/ui/number-input';
import { PopoverSelect } from '@/components/ui/popover-select';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import { BrowserSettingsDisclosure } from './browser-settings-disclosure';
import { BrowserStatusPanel } from './browser-status-panel';
import { AgentDefaultsRouteLayout } from './browser-settings-route-layout';
import { useAgentDefaultsForm } from './use-browser-settings-form';

const driverKinds = ['extension', 'playwright', 'cdp', 'remote'] as const;

export function AgentBrowserSettingsPage() {
  const language = useLocaleStore((state) => state.language);
  const bundle = messages(language);
  const vm = useAgentDefaultsForm(bundle.agentSettings);
  const form = vm.form;
  const zh = language === 'zh';
  const [searchParams] = useSearchParams();
  const appliedDeepLink = useRef(false);

  useEffect(() => {
    if (!form || appliedDeepLink.current) return;
    appliedDeepLink.current = true;
    const requested = searchParams.get('driver');
    if (driverKinds.includes(requested as typeof driverKinds[number]) && requested !== form.driverKind) {
      vm.update({ driverKind: requested as typeof form.driverKind });
    }
  }, [form, searchParams, vm.update]);

  const driverOptions = [
    { value: 'extension', label: zh ? 'Chrome 扩展（推荐）' : 'Chrome extension (recommended)' },
    { value: 'playwright', label: 'Playwright Chromium' },
    { value: 'cdp', label: zh ? 'CDP 已有浏览器' : 'Existing browser over CDP' },
    { value: 'remote', label: zh ? '远程浏览器' : 'Remote browser' },
  ];

  return (
    <AgentDefaultsRouteLayout
      sectionId="agent-browser"
      aiSetup="browser"
      vm={vm}
    >
      {form ? <>


        <section className="rounded-2xl border border-edge bg-surface-panel p-4 sm:p-5" aria-label={zh ? '浏览器控制设置' : 'Browser control settings'}>
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface-inset text-fg-muted"><Globe className="size-6" aria-hidden /></span>
            <div className="min-w-0 flex-1"><Toggle label={zh ? '启用浏览器控制' : 'Enable browser control'} description={zh ? '让 AI 帮你操作浏览器。' : 'Let AI work with your browser.'} checked={form.enabled} onChange={enabled => vm.update({ enabled })} /></div>
          </div>
        </section>

        <Section title={zh ? '连接方式' : 'Browser connection'}>
          <PopoverSelect ariaLabel={zh ? '浏览器连接' : 'Browser connection'} value={form.driverKind} options={driverOptions} placeholder={zh ? '选择连接方式' : 'Choose a connection'} allowEmpty={false} onChange={(driverKind) => vm.update({ driverKind: driverKind as typeof form.driverKind })} />
          <BrowserSettingsDisclosure name="connection-help" title={zh ? '了解此连接方式' : 'About this connection'} inset icon={<Info className="size-4" />}><DriverDescription kind={form.driverKind} zh={zh} /></BrowserSettingsDisclosure>

          {form.driverKind === 'playwright' ? <BrowserSettingsDisclosure name="playwright-options" title={zh ? '运行选项' : 'Launch options'} summary={form.headless ? (zh ? '后台运行' : 'Headless') : (zh ? '显示窗口' : 'Visible window')} inset>
            <Toggle label={zh ? '无头模式' : 'Headless mode'} description={zh ? '后台运行，不显示浏览器窗口。关闭后可观察智能体的操作过程。' : 'Run in the background without a visible window. Turn off to watch the agent work.'} checked={form.headless} onChange={(headless) => vm.update({ headless })} />
            <TextField label={zh ? 'Chromium 可执行文件（可选）' : 'Chromium executable (optional)'} description={zh ? '留空时使用由 xopc 安装的 Chromium。' : 'Leave empty to use Chromium installed by xopc.'} value={form.executablePath} onChange={(executablePath) => vm.update({ executablePath })} />
          </BrowserSettingsDisclosure> : null}
          {form.driverKind === 'cdp' ? <div className="rounded-lg bg-surface-inset p-4"><TextField label="CDP endpoint" description={zh ? '例如 http://127.0.0.1:9222。Chrome 需要开启 remote debugging。' : 'For example http://127.0.0.1:9222. Chrome must be started with remote debugging enabled.'} value={form.cdpEndpoint} onChange={(cdpEndpoint) => vm.update({ cdpEndpoint })} /></div> : null}
          {form.driverKind === 'remote' ? <div className="space-y-4 rounded-lg bg-surface-inset p-4">
            <Field label={zh ? '服务商' : 'Provider'}><PopoverSelect value={form.remoteProvider} options={[{ value: 'browserbase', label: 'Browserbase' }, { value: 'browser-use', label: 'Browser Use' }]} placeholder={zh ? '选择服务商' : 'Choose a provider'} allowEmpty={false} onChange={(remoteProvider) => vm.update({ remoteProvider: remoteProvider as typeof form.remoteProvider })} /></Field>
            <TextField label="API key" type="password" autoComplete="off" value={form.remoteApiKey} onChange={(remoteApiKey) => vm.update({ remoteApiKey })} />
            <TextField label="Project ID" value={form.remoteProjectId} onChange={(remoteProjectId) => vm.update({ remoteProjectId })} />
            <BrowserSettingsDisclosure name="remote-options" title={zh ? '服务商选项' : 'Provider options'} inset><TextField label="Region" value={form.remoteRegion} onChange={(remoteRegion) => vm.update({ remoteRegion })} /></BrowserSettingsDisclosure>
          </div> : null}
        </Section>

        <BrowserStatusPanel enabled={form.enabled} driverKind={form.driverKind} autosaveStatus={vm.autosaveStatus} zh={zh} />

        <BrowserSettingsDisclosure name="execution" title={zh ? "页面理解与执行限制" : "Observation & execution"} summary={zh ? "高级" : "Advanced"} icon={<Settings2 className="size-5" />}>
          <>
            <Section title={zh ? '页面理解' : 'Page understanding'} icon={<Eye className="size-4" />}>
              <Toggle label={zh ? '需要时附加截图' : 'Attach screenshots when needed'} checked={form.visualFallback} onChange={(visualFallback) => vm.update({ visualFallback })} />
              <div className="grid gap-4 sm:grid-cols-2"><NumberField label={zh ? '语义节点上限' : 'Semantic node limit'} description="20–500" min={20} max={500} value={form.maxNodes} onChange={(maxNodes) => vm.update({ maxNodes })} /><NumberField label={zh ? '文本字符上限' : 'Text character limit'} description="1,000–50,000" min={1_000} max={50_000} step={1_000} value={form.maxCharacters} onChange={(maxCharacters) => vm.update({ maxCharacters })} /></div>
            </Section>

            <Section title={zh ? '执行限制' : 'Execution limits'} icon={<Gauge className="size-4" />}>
              <div className="grid gap-4 sm:grid-cols-3"><NumberField label={zh ? '操作超时（毫秒）' : 'Action timeout (ms)'} min={1_000} max={120_000} step={1_000} value={form.actionTimeoutMs} onChange={(actionTimeoutMs) => vm.update({ actionTimeoutMs })} /><NumberField label={zh ? '会话超时（毫秒）' : 'Session timeout (ms)'} min={60_000} max={3_600_000} step={60_000} value={form.sessionTimeoutMs} onChange={(sessionTimeoutMs) => vm.update({ sessionTimeoutMs })} /><NumberField label={zh ? '批量步骤上限' : 'Sequence step limit'} min={1} max={10} value={form.maxSequenceLength} onChange={(maxSequenceLength) => vm.update({ maxSequenceLength })} /></div>
            </Section>
          </>
        </BrowserSettingsDisclosure>
        <BrowserSettingsDisclosure name="access" title={zh ? '访问策略' : 'Access policies'} summary={zh ? '权限与私网' : 'Permissions'} icon={<LockKeyhole className="size-5" />}>
          <BrowserSettingsDisclosure name="private-hosts" title={zh ? "私网访问例外" : "Private network exceptions"} inset summary={form.allowedPrivateHosts || (zh ? "未设置私网例外" : "No private network exceptions")}>
            <TextField label={zh ? '允许访问的私网主机' : 'Allowed private hosts'} description={zh ? '每行一个主机名或 IP，不支持通配符。' : 'One hostname or IP per line. Wildcards are not supported.'} multiline value={form.allowedPrivateHosts} onChange={(allowedPrivateHosts) => vm.update({ allowedPrivateHosts })} />
          </BrowserSettingsDisclosure>
          <div className="grid gap-4 sm:grid-cols-3"><Policy zh={zh} label={zh ? '跨域导航' : 'Cross-domain navigation'} value={form.crossDomainNavigation} onChange={(crossDomainNavigation) => vm.update({ crossDomainNavigation })} /><Policy zh={zh} label={zh ? '高影响动作' : 'Consequential actions'} value={form.consequentialActions} onChange={(consequentialActions) => vm.update({ consequentialActions })} /><Policy zh={zh} label={zh ? '文件上传' : 'File uploads'} value={form.uploads} onChange={(uploads) => vm.update({ uploads })} /></div>
        </BrowserSettingsDisclosure>
      </> : null}
    </AgentDefaultsRouteLayout>
  );
}

function DriverDescription({ kind, zh }: { kind: typeof driverKinds[number]; zh: boolean }) {
  const copy = {
    extension: zh ? '直接操作你正在使用的 Chrome，保留登录状态和现有标签页；最适合日常协作。' : 'Operate your current Chrome with its signed-in state and existing tabs; best for daily collaboration.',
    playwright: zh ? '由 xopc 启动独立 Chromium，环境隔离、自动化稳定，适合无人值守任务。' : 'Let xopc launch an isolated Chromium; stable for unattended automation.',
    cdp: zh ? '连接已开启远程调试的 Chrome 或 Chromium，适合自定义浏览器启动方式。' : 'Connect to Chrome or Chromium already running with remote debugging.',
    remote: zh ? '使用 Browserbase 或 Browser Use 的云端浏览器，适合服务器环境和长任务。' : 'Use a Browserbase or Browser Use cloud browser for servers and long-running tasks.',
  };
  return <p className="rounded-lg bg-surface-inset px-3 py-2 text-xs leading-5 text-fg-muted">{copy[kind]}</p>;
}

function Section({ title, description, icon, children }: { title: string; description?: string; icon?: ReactNode; children: ReactNode }) {
  return <section className="rounded-2xl border border-edge bg-surface-panel p-4 sm:p-5"><div className="mb-4 flex items-start gap-2">{icon && <span className="mt-0.5 text-fg-subtle" aria-hidden>{icon}</span>}<div><h2 className="text-sm font-semibold text-fg">{title}</h2>{description ? <p className="mt-1 text-xs leading-5 text-fg-muted">{description}</p> : null}</div></div><div className="space-y-4">{children}</div></section>;
}
function Field({ label, description, children }: { label: string; description?: string; children: ReactNode }) { return <label className="block text-sm text-fg"><span className="mb-1.5 block font-medium">{label}</span>{children}{description ? <span className="mt-1.5 block text-xs leading-5 text-fg-subtle">{description}</span> : null}</label>; }
function TextField({ label, description, value, onChange, type = 'text', multiline = false, autoComplete }: { label: string; description?: string; value: string; onChange: (value: string) => void; type?: string; multiline?: boolean; autoComplete?: string }) { const className = 'w-full rounded-lg border border-edge bg-surface-inset px-3 py-2 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'; return <Field label={label} description={description}>{multiline ? <textarea rows={3} value={value} onChange={(event) => onChange(event.target.value)} className={className} /> : <input type={type} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} className={className} />}</Field>; }
function NumberField({ label, description, value, onChange, min, max, step = 1 }: { label: string; description?: string; value: number; onChange: (value: number) => void; min: number; max: number; step?: number }) { return <Field label={label} description={description}><NumberInput type="number" min={min} max={max} step={step} value={value} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next); }} className="h-10 w-full rounded-lg border border-edge bg-surface-inset px-3 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" /></Field>; }
function Toggle({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="flex items-center justify-between gap-4">
    <div className="min-w-0"><span className="block text-sm font-semibold text-fg">{label}</span>{description && <p className="mt-1 text-xs leading-5 text-fg-muted">{description}</p>}</div>
    <button type="button" role="switch" aria-label={label} aria-checked={checked} onClick={() => onChange(!checked)} className="touch-target flex shrink-0 items-center rounded-lg px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
      <span className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors motion-reduce:transition-none ${checked ? 'bg-accent' : 'bg-fg-muted/30'}`}><span className={`size-5 rounded-full bg-white transition-transform motion-reduce:transition-none ${checked ? 'translate-x-5' : 'translate-x-0'}`} /></span>
    </button>
  </div>;
}
function Policy({ zh, label, value, onChange }: { zh: boolean; label: string; value: 'allow' | 'deny'; onChange: (value: 'allow' | 'deny') => void }) { const options = [{ value: 'allow', label: zh ? '允许' : 'Allow' }, { value: 'deny', label: zh ? '拒绝' : 'Deny' }]; return <Field label={label}><PopoverSelect value={value} options={options} placeholder={zh ? '选择策略' : 'Choose a policy'} allowEmpty={false} onChange={(next) => onChange(next as typeof value)} /></Field>; }

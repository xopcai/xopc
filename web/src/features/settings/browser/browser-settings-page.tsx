import { PopoverSelect } from '@/components/ui/popover-select';
import type { ReactNode } from 'react';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import { AgentDefaultsRouteLayout } from './browser-settings-route-layout';
import { useAgentDefaultsForm } from './use-browser-settings-form';

const driverOptions = [
  { value: 'extension', label: 'Chrome extension' },
  { value: 'playwright', label: 'Playwright Chromium' },
  { value: 'cdp', label: 'CDP endpoint' },
  { value: 'remote', label: 'Remote browser' },
];
const policyOptions = [
  { value: 'ask', label: 'Ask' },
  { value: 'allow', label: 'Allow' },
  { value: 'deny', label: 'Deny' },
];

export function AgentBrowserSettingsPage() {
  const language = useLocaleStore((state) => state.language);
  const bundle = messages(language);
  const vm = useAgentDefaultsForm(bundle.agentSettings);
  const form = vm.form;
  const zh = language === 'zh';

  return (
    <AgentDefaultsRouteLayout sectionId="agent-browser" intro="" vm={vm}>
      {form ? <>
        <Section title={zh ? '运行方式' : 'Driver'}>
          <Toggle label={zh ? '启用浏览器控制' : 'Enable browser control'} checked={form.enabled} onChange={(enabled) => vm.update({ enabled })} />
          <Field label={zh ? '驱动' : 'Driver'}><PopoverSelect value={form.driverKind} options={driverOptions} placeholder="Driver" allowEmpty={false} onChange={(driverKind) => vm.update({ driverKind: driverKind as typeof form.driverKind })} /></Field>
          {form.driverKind === 'extension' ? <p className="text-xs text-fg-muted">127.0.0.1:19820</p> : null}
          {form.driverKind === 'playwright' ? <><Toggle label={zh ? '无头模式' : 'Headless'} checked={form.headless} onChange={(headless) => vm.update({ headless })} /><TextField label={zh ? 'Chromium 路径（可选）' : 'Chromium path (optional)'} value={form.executablePath} onChange={(executablePath) => vm.update({ executablePath })} /></> : null}
          {form.driverKind === 'cdp' ? <TextField label="CDP endpoint" value={form.cdpEndpoint} onChange={(cdpEndpoint) => vm.update({ cdpEndpoint })} /> : null}
          {form.driverKind === 'remote' ? <><Field label={zh ? '服务商' : 'Provider'}><PopoverSelect value={form.remoteProvider} options={[{ value: 'browserbase', label: 'Browserbase' }, { value: 'browser-use', label: 'Browser Use' }]} placeholder="Provider" allowEmpty={false} onChange={(remoteProvider) => vm.update({ remoteProvider: remoteProvider as typeof form.remoteProvider })} /></Field><TextField label="API key" type="password" value={form.remoteApiKey} onChange={(remoteApiKey) => vm.update({ remoteApiKey })} /><div className="grid gap-4 sm:grid-cols-2"><TextField label="Project ID" value={form.remoteProjectId} onChange={(remoteProjectId) => vm.update({ remoteProjectId })} /><TextField label="Region" value={form.remoteRegion} onChange={(remoteRegion) => vm.update({ remoteRegion })} /></div></> : null}
        </Section>

        <Section title={zh ? '观察与限制' : 'Observation and limits'}>
          <Toggle label={zh ? '语义信息不足时附加截图' : 'Attach a screenshot when semantics are insufficient'} checked={form.visualFallback} onChange={(visualFallback) => vm.update({ visualFallback })} />
          <div className="grid gap-4 sm:grid-cols-3"><NumberField label="Max nodes" value={form.maxNodes} onChange={(maxNodes) => vm.update({ maxNodes })} /><NumberField label="Max characters" value={form.maxCharacters} onChange={(maxCharacters) => vm.update({ maxCharacters })} /><NumberField label="Sequence length" value={form.maxSequenceLength} onChange={(maxSequenceLength) => vm.update({ maxSequenceLength })} /></div>
          <div className="grid gap-4 sm:grid-cols-2"><NumberField label="Action timeout (ms)" value={form.actionTimeoutMs} onChange={(actionTimeoutMs) => vm.update({ actionTimeoutMs })} /><NumberField label="Session timeout (ms)" value={form.sessionTimeoutMs} onChange={(sessionTimeoutMs) => vm.update({ sessionTimeoutMs })} /></div>
        </Section>

        <Section title={zh ? '安全策略' : 'Security'}>
          <TextField label={zh ? '允许的内网主机（每行一个精确主机名）' : 'Allowed private hosts (one exact hostname per line)'} multiline value={form.allowedPrivateHosts} onChange={(allowedPrivateHosts) => vm.update({ allowedPrivateHosts })} />
          <div className="grid gap-4 sm:grid-cols-3"><Policy label={zh ? '跨域导航' : 'Cross-domain navigation'} value={form.crossDomainNavigation} onChange={(crossDomainNavigation) => vm.update({ crossDomainNavigation })} /><Policy label={zh ? '高影响动作' : 'Consequential actions'} value={form.consequentialActions} onChange={(consequentialActions) => vm.update({ consequentialActions })} /><Policy label={zh ? '上传' : 'Uploads'} value={form.uploads} onChange={(uploads) => vm.update({ uploads })} /></div>
        </Section>
      </> : null}
    </AgentDefaultsRouteLayout>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) { return <section className="rounded-xl border border-edge bg-surface-base p-5"><h2 className="mb-4 text-sm font-semibold text-fg">{title}</h2><div className="space-y-4">{children}</div></section>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block text-sm text-fg"><span className="mb-1.5 block font-medium">{label}</span>{children}</label>; }
function TextField({ label, value, onChange, type = 'text', multiline = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; multiline?: boolean }) { const className = 'w-full rounded-lg border border-edge bg-surface-subtle px-3 py-2 text-sm text-fg outline-none focus:border-accent'; return <Field label={label}>{multiline ? <textarea rows={3} value={value} onChange={(event) => onChange(event.target.value)} className={className} /> : <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className={className} />}</Field>; }
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <Field label={label}><input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} className="h-10 w-full rounded-lg border border-edge bg-surface-subtle px-3 text-sm text-fg outline-none focus:border-accent" /></Field>; }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="flex items-center gap-3 text-sm text-fg"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-4 accent-accent" />{label}</label>; }
function Policy({ label, value, onChange }: { label: string; value: 'allow' | 'ask' | 'deny'; onChange: (value: 'allow' | 'ask' | 'deny') => void }) { return <Field label={label}><PopoverSelect value={value} options={policyOptions} placeholder="Policy" allowEmpty={false} onChange={(next) => onChange(next as typeof value)} /></Field>; }

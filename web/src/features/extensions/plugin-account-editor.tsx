import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { ExtensionApiRow } from './types';
import type { PluginAccount, PluginAuthorizationAttempt } from './plugin-setup-types';

type Fields = NonNullable<ExtensionApiRow['setup']>['userConfig'];
export function PluginCredentialFields({ fields, values, onChange }: { fields: Fields; values: Record<string, unknown>; onChange: (values: Record<string, unknown>) => void }) {
  return <>{Object.entries(fields).map(([key, field]) => <label key={key} className="block space-y-1.5 text-sm"><span>{field.title}{field.required ? ' *' : ''}</span>{field.type === 'boolean' ? <input type="checkbox" checked={values[key] === true} onChange={event => onChange({ ...values, [key]: event.target.checked })} /> : <input className="w-full rounded-lg border border-edge bg-surface-inset px-3 py-2.5" type={field.sensitive ? 'password' : field.type === 'number' ? 'number' : 'text'} required={field.required} autoComplete="off" value={String(values[key] ?? '')} onChange={event => onChange({ ...values, [key]: field.type === 'number' ? Number(event.target.value) : event.target.value })} />}</label>)}</>;
}
export function PluginAccountEditor({ account, fields, zh, busy, attempt, initialMethod, onBack, onConnect, onSave, onRedirect, onSkip }: {
  account: PluginAccount; fields: Fields; zh: boolean; busy: boolean; initialMethod?: string; attempt: PluginAuthorizationAttempt | null;
  onBack: () => void; onConnect: (method: string) => void; onSave: (method: string, values: Record<string, unknown>) => void;
  onRedirect: (url: string) => void; onSkip: () => void;
}) {
  const [selected, setSelected] = useState(initialMethod && account.methods.some(method => method.id === initialMethod) ? initialMethod : account.methods[0]?.id ?? '');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [callback, setCallback] = useState('');
  const [image, setImage] = useState<string>();
  const method = account.methods.find(value => value.id === selected)!;
  const t = (cn: string, en: string) => zh ? cn : en;
  const qr = attempt?.challenge?.type === 'qr' ? attempt.challenge.url : undefined;
  useEffect(() => {
    let stopped = false; setImage(undefined);
    if (qr) void QRCode.toDataURL(qr, { width: 240, margin: 2 }).then(value => { if (!stopped) setImage(value); }).catch(() => undefined);
    return () => { stopped = true; };
  }, [qr]);
  const activeAttempt = attempt && !['cancelled', 'error', 'connected'].includes(attempt.state);
  const authorizationUrl = attempt?.authorizationUrl ?? attempt?.challenge?.url;
  return <section className="space-y-5" aria-label={t(`连接 ${account.title}`, `Connect ${account.title}`)}>
    <div className="flex items-start gap-3"><Button variant="ghost" className="shrink-0" onClick={onBack} aria-label={t('返回插件详情', 'Back to plugin details')}><ArrowLeft className="size-4" /></Button><div><h3 className="text-base font-semibold">{t('连接 ', 'Connect ')}{account.title}</h3><p className="mt-1 text-sm text-fg-muted">{account.description ?? t('完成授权后自动检查连接。也可以稍后在详情页继续。', 'The connection is checked after authorization. You can also continue later in plugin details.')}</p></div></div>
    {account.methods.length > 1 ? <div role="tablist" aria-label={t('授权方式', 'Authorization methods')} className="flex flex-wrap gap-2 rounded-lg bg-surface-inset p-1.5">{account.methods.map(value => <button key={value.id} role="tab" type="button" aria-selected={selected === value.id} className={`min-h-10 rounded-md px-3 text-sm ${selected === value.id ? 'bg-surface-panel font-medium text-fg' : 'text-fg-muted'}`} disabled={busy || !!activeAttempt} onClick={() => { setSelected(value.id); setValues({}); }}>{value.title}</button>)}</div> : null}
    {method?.instructions?.length || method?.helpUrl ? <div className="space-y-3 rounded-lg border border-edge bg-surface-inset p-4 text-sm text-fg-muted">{method.instructions?.length ? <ol className="list-decimal space-y-2 pl-5">{method.instructions.map((line, i) => <li key={i}>{line}</li>)}</ol> : null}{method.helpUrl ? <a className="text-accent underline" href={method.helpUrl} target="_blank" rel="noopener noreferrer">{t('打开官方配置说明', 'Open setup instructions')}</a> : null}</div> : null}
    {(method?.type === 'form' || method?.fields?.length) && !activeAttempt ? <form className="space-y-4" onSubmit={event => { event.preventDefault(); onSave(method.id, values); }}><PluginCredentialFields fields={Object.fromEntries((method.fields ?? []).filter(key => fields[key]).map(key => [key, { ...fields[key], required: true }]))} values={values} onChange={setValues} /><Button type="submit" disabled={busy || !method.fields?.every(key => values[key] !== undefined && values[key] !== '')}>{busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}{t('保存并连接', 'Save and connect')}</Button></form> : <div className="space-y-4">
      {!activeAttempt ? <Button disabled={busy} onClick={() => onConnect(selected)}>{t('连接账号', 'Connect account')}</Button> : null}
      {activeAttempt ? <p role="status" className="text-sm text-fg-muted">{attempt.challenge?.message ?? (attempt.state === 'preparing' ? t('正在准备登录…', 'Preparing sign-in…') : t('请完成登录，返回后会自动继续。', 'Finish signing in. Installation continues automatically.'))}</p> : null}
      {qr && activeAttempt ? image ? <img src={image} alt={t(`使用 ${account.title} 扫码授权`, `Scan to authorize ${account.title}`)} className="mx-auto size-60 max-w-full rounded-lg" /> : <Skeleton className="mx-auto size-60" /> : null}
      {authorizationUrl && activeAttempt ? <a href={authorizationUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-accent underline">{qr ? t('也可以打开授权页面', 'Or open the authorization page') : t('打开登录页面', 'Open sign-in page')}</a> : null}
      {attempt?.expiresAt && activeAttempt ? <p className="text-center text-xs text-fg-muted">{t('本次授权有效期至 ', 'This sign-in expires at ')}{new Date(attempt.expiresAt).toLocaleTimeString()}</p> : null}
      {attempt?.error ? <p role="alert" className="text-sm text-fg-muted">{attempt.error}</p> : null}
      {attempt?.acceptsRedirect && activeAttempt ? <details className="text-sm"><summary className="cursor-pointer text-fg-muted">{t('登录后没有自动返回？', 'Did sign-in not return automatically?')}</summary><form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); onRedirect(callback); }}><label>{t('登录回调地址', 'Sign-in callback URL')}<input value={callback} onChange={event => setCallback(event.target.value)} className="mt-1 w-full rounded-lg border border-edge bg-surface-inset p-2" /></label><Button type="submit" disabled={busy || !callback}>{t('继续登录', 'Continue sign-in')}</Button></form></details> : null}
    </div>}
    <div className="border-t border-edge pt-4"><Button variant="secondary" disabled={busy} onClick={onSkip}>{t('暂时跳过', 'Skip for now')}</Button><p className="mt-2 text-xs text-fg-muted">{t('相关功能暂不可用，可随时在插件详情中授权。', 'Features requiring this account stay unavailable. Connect later in plugin details.')}</p></div>
  </section>;
}

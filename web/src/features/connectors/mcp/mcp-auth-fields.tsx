import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import type { McpSettingsMessages } from '@/i18n/messages';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';

import { type McpAuthDraft, type McpAuthMode } from './mcp-auth-draft';
import { McpHeadersEditor } from './mcp-headers-editor';
import type { McpHeaderEntry } from './mcp-headers-utils';

export const mcpInputClass = cn('w-full min-w-0 rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg', settingsInputFocusClass);

export function McpSecretInput({ value, onChange, label, t, required = false }: {
  value: string; onChange: (value: string) => void; label: string; t: McpSettingsMessages; required?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return <div className="space-y-1.5">
    <label className="block text-sm font-medium text-fg">{label}
      <input className={cn(mcpInputClass, 'mt-1.5')} type={visible ? 'text' : 'password'} value={value} required={required}
        autoComplete="off" onChange={event => onChange(event.target.value)} />
    </label>
    <Button type="button" variant="ghost" className="gap-1.5 text-xs" onClick={() => setVisible(current => !current)}>
      {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}{visible ? t.setupHideValue : t.setupShowValue}
    </Button>
  </div>;
}

export function McpHeaderFields({ headers, onChange, t, additional = false, environment = false }: {
  headers: McpHeaderEntry[]; onChange: (headers: McpHeaderEntry[]) => void; t: McpSettingsMessages; additional?: boolean; environment?: boolean;
}) {
  return <McpHeadersEditor label={environment ? t.envLabel : additional ? t.setupAdditionalHeaders : t.headersLabel}
    optionalLabel={t.optionalSuffix} addLabel={environment ? t.setupAddEnv : t.addHeader} removeHeaderAria={environment ? t.setupRemoveEnv : t.removeHeader}
    pasteLabel={t.pasteHeaders} pasteFailed={t.pasteHeadersFailed} pasteFailedTitle={t.pasteHeadersFailedTitle}
    dismissLabel={t.pasteHeadersDismiss} keyPlaceholder={environment ? t.setupEnvName : t.headerKeyPlaceholder}
    valuePlaceholder={environment ? t.setupEnvValue : t.headerValuePlaceholder} headers={headers} onChange={onChange}
    referenceLabel={t.setupReference} showValueLabel={t.setupShowValue} hideValueLabel={t.setupHideValue} allowPaste={!environment} />;
}

export function McpAuthFields({ draft, onChange, t, allowExisting }: { allowExisting?: boolean; draft: McpAuthDraft; onChange: (patch: Partial<McpAuthDraft>) => void; t: McpSettingsMessages }) {
  return <div className="space-y-4">
    <label className="block text-sm font-medium text-fg">{t.setupAuthLabel}
      <Select aria-label={t.setupAuthLabel} className={cn(mcpInputClass, 'mt-1.5')} value={draft.mode} onChange={event => onChange({ mode: event.target.value as McpAuthMode })}>
        {(['auto', 'oauth', 'bearer', 'apiKey', 'headers', 'none'] as const).map(mode => <SelectOption key={mode} value={mode}>{t.setupAuthModes[mode]}</SelectOption>)}
        {allowExisting || draft.mode === 'existing' ? <SelectOption value="existing">{t.setupAuthModes.existing}</SelectOption> : null}
      </Select>
    </label>
    {draft.mode === 'auto' ? <p className="text-xs text-fg-muted">{t.setupAuthAutoHint}</p> : null}
    {draft.mode === 'oauth' ? <p className="text-xs text-fg-muted">{t.setupAuthOAuthHint}</p> : null}
    {draft.mode === 'existing' ? <p className="text-xs text-fg-muted">{t.setupExistingHint}</p> : null}
    {draft.mode === 'bearer' ? <><McpSecretInput value={draft.token} onChange={token => onChange({ token })} label={t.setupTokenLabel} t={t} required /><p className="text-xs text-fg-muted">{t.setupTokenHint}</p></> : null}
    {draft.mode === 'apiKey' ? <>
      <label className="block text-sm font-medium text-fg">{t.setupApiKeyHeader}
        <input className={cn(mcpInputClass, 'mt-1.5')} placeholder="x-api-key" value={draft.headerName} required onChange={event => onChange({ headerName: event.target.value })} />
      </label>
      <p className="text-xs text-fg-muted">{t.setupApiKeyHint}</p>
      <McpSecretInput value={draft.apiKey} onChange={apiKey => onChange({ apiKey })} label="API Key" t={t} required />
    </> : null}
    {draft.mode === 'headers' ? <McpHeaderFields headers={draft.customHeaders} onChange={customHeaders => onChange({ customHeaders })} t={t} /> : null}
  </div>;
}

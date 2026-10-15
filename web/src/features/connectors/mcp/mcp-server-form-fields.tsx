import { Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectOption } from '@/components/ui/popover-select';
import type { McpSettingsMessages } from '@/i18n/messages';

import { McpHeaderFields, mcpInputClass } from './mcp-auth-fields';
import { parseArgsText, type McpServerRow } from './mcp-config-api';
import { headersToRecord, recordToHeaders } from './mcp-headers-utils';

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block space-y-1.5 text-sm font-medium text-fg"><span>{label}</span>{children}
    {hint ? <span className="block text-xs font-normal text-fg-muted">{hint}</span> : null}</label>;
}

function CommandOptions({ row, t, onUpdate }: { row: McpServerRow; t: McpSettingsMessages; onUpdate: (patch: Partial<McpServerRow>) => void }) {
  const [environment, setEnvironment] = useState(() => recordToHeaders(row.envJson ? JSON.parse(row.envJson) : undefined));
  const [rawArgs, setRawArgs] = useState(false);
  let args: string[] = [];
  try { args = parseArgsText(row.argsText) ?? []; } catch { /* The raw editor keeps invalid input for correction. */ }
  const updateArgs = (values: string[]) => onUpdate({ argsText: JSON.stringify(values) });
  return <div data-field="commandOptions" className="space-y-4">
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-fg">{t.argsLabel}</span>
        <Button type="button" variant="ghost" onClick={() => setRawArgs(current => !current)}>{rawArgs ? t.setupArgsRows : t.setupArgsPaste}</Button>
      </div>
      {rawArgs ? <Field label={t.setupArgsPaste} hint={t.argsHint}><input className={mcpInputClass} value={row.argsText} onChange={event => onUpdate({ argsText: event.target.value })} /></Field>
        : args.map((arg, index) => <div key={index} className="flex min-w-0 items-center gap-2">
          <input className={mcpInputClass} aria-label={`${t.argsLabel} ${index + 1}`} value={arg}
            onChange={event => updateArgs(args.map((value, i) => i === index ? event.target.value : value))} />
          <Button type="button" variant="ghost" aria-label={t.setupRemoveArg} onClick={() => updateArgs(args.filter((_, i) => i !== index))}><Trash2 className="size-4" aria-hidden /></Button>
        </div>)}
      {!rawArgs ? <Button type="button" variant="ghost" onClick={() => updateArgs([...args, ''])}><Plus className="size-4" aria-hidden />{t.setupAddArg}</Button> : null}
    </div>
    <McpHeaderFields environment headers={environment} t={t} onChange={values => {
      setEnvironment(values); onUpdate({ envEntries: values, envJson: JSON.stringify(headersToRecord(values) ?? {}) });
    }} />
  </div>;
}

export function McpServerFormFields({ row, t, onUpdate, variant = 'all', showOAuth = false, idReadOnly = false }: {
  row: McpServerRow; t: McpSettingsMessages; onUpdate: (patch: Partial<McpServerRow>) => void;
  variant?: 'all' | 'basic' | 'advanced'; showOAuth?: boolean; idReadOnly?: boolean;
}) {
  const basic = variant !== 'advanced';
  const advanced = variant !== 'basic';
  return <div className="space-y-4">
    {basic ? <>
      {row.transport === 'stdio' ? <>
        <Field label={`${t.commandLabel} *`}><input data-field="command" className={mcpInputClass} value={row.command} required onChange={event => onUpdate({ command: event.target.value })} /></Field>
        <CommandOptions row={row} t={t} onUpdate={onUpdate} />
      </> : <Field label={`${t.urlLabel} *`}><input data-field="url" className={mcpInputClass} value={row.url} placeholder="https://example.com/mcp" required onChange={event => onUpdate({ url: event.target.value })} /></Field>}
      <Field label={t.setupNameLabel} hint={t.setupNameHint}><input className={mcpInputClass} value={row.displayName ?? ''} placeholder={t.setupNamePlaceholder} onChange={event => onUpdate({ displayName: event.target.value })} /></Field>
    </> : null}
    {advanced ? <>
      <Field label={t.serverIdLabel} hint={t.setupIdHint}><input className={mcpInputClass} readOnly={idReadOnly} value={row.id} onChange={event => onUpdate({ id: event.target.value })} placeholder={t.serverIdPlaceholder} /></Field>
      {row.transport === 'stdio' ? <Field label={t.cwdLabel}><input className={mcpInputClass} value={row.cwd} onChange={event => onUpdate({ cwd: event.target.value })} /></Field> : null}
      {row.transport !== 'stdio' && showOAuth ? <Field label={t.oauthClientIdLabel} hint={t.oauthClientIdHint}><input className={mcpInputClass} value={row.oauthClientId} onChange={event => onUpdate({ oauthClientId: event.target.value })} /></Field> : null}
      <Field label={t.exposureLabel} hint={t.setupExposureHint}><Select aria-label={t.exposureLabel} className={mcpInputClass} value={row.exposure} onChange={event => onUpdate({ exposure: event.target.value as McpServerRow['exposure'] })}>
        {(['codemode', 'deferred', 'direct', 'hidden'] as const).map(value => <SelectOption key={value} value={value}>{t.exposureLabels[value]}</SelectOption>)}
      </Select></Field>
      <Field label={t.requestTimeoutLabel}><NumberInput allowEmpty type="number" min={1} className={mcpInputClass} value={row.timeout ?? ''} placeholder={t.setupDefaultTimeout}
        onChange={event => onUpdate({ timeout: event.target.value ? Number(event.target.value) : undefined })} /></Field>
    </> : null}
  </div>;
}

import { useState } from 'react';

import { Select, SelectOption } from '@/components/ui/popover-select';
import type { GatewaySettingsMessages } from '@/i18n/messages';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';

import { isValidOutboundProxyUrl } from './gateway-config-api';
import type { GatewaySettingsState } from './gateway-settings.types';

type ProxySettings = GatewaySettingsState['outboundProxy'];

export function GatewayOutboundProxySettings({ value, onChange, g }: {
  value: ProxySettings; onChange: (value: ProxySettings) => void; g: GatewaySettingsMessages;
}) {
  const [touched, setTouched] = useState(false);
  const invalid = touched && value.mode === 'custom' && !isValidOutboundProxyUrl(value.url);
  const inputClass = cn('w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-subtle', settingsInputFocusClass);
  return <section className="space-y-3 rounded-xl border border-edge p-4" aria-labelledby="outbound-proxy-title">
    <h2 id="outbound-proxy-title" className="text-sm font-semibold text-fg">{g.outboundProxyTitle}</h2>
    <p className="text-xs text-fg-muted">{g.outboundProxyHint}</p>
    <div className="space-y-1">
      <label htmlFor="outbound-proxy-mode" className="block text-sm font-medium text-fg">{g.outboundProxyMode}</label>
      <Select id="outbound-proxy-mode" value={value.mode} onChange={event => onChange({ ...value, mode: event.target.value as ProxySettings['mode'] })}>
        <SelectOption value="environment">{g.outboundProxyEnvironment}</SelectOption>
        <SelectOption value="custom">{g.outboundProxyCustom}</SelectOption>
        <SelectOption value="direct">{g.outboundProxyDirect}</SelectOption>
      </Select>
    </div>
    {value.mode === 'custom' && <div className="space-y-1">
      <label htmlFor="outbound-proxy-url" className="block text-sm font-medium text-fg">{g.outboundProxyUrl}</label>
      <input id="outbound-proxy-url" className={inputClass} value={value.url} placeholder="http://127.0.0.1:7897"
        autoComplete="off" spellCheck={false} aria-invalid={invalid} aria-describedby={invalid ? 'outbound-proxy-error' : undefined}
        onChange={event => onChange({ ...value, url: event.target.value })} onBlur={() => setTouched(true)} />
      {invalid && <p id="outbound-proxy-error" role="alert" className="text-xs text-danger">{g.outboundProxyInvalid}</p>}
    </div>}
    {value.mode !== 'direct' && <div className="space-y-1">
      <label htmlFor="outbound-proxy-bypass" className="block text-sm font-medium text-fg">{g.outboundProxyBypass}</label>
      <input id="outbound-proxy-bypass" className={inputClass} value={value.noProxy} placeholder=".example.com,192.168.1.10"
        autoComplete="off" spellCheck={false} aria-describedby="outbound-proxy-bypass-hint" onChange={event => onChange({ ...value, noProxy: event.target.value })} />
      <p id="outbound-proxy-bypass-hint" className="text-xs text-fg-muted">{g.outboundProxyBypassHint}</p>
    </div>}
  </section>;
}

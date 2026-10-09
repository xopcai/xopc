import { useEffect, useState } from 'react';
import { PersonalProactivitySettingsSchema, type PersonalProactivitySettings } from '@xopcai/gateway-contract';

import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

function supportedTimezones(): string[] {
  try {
    return ['UTC', ...Intl.supportedValuesOf('timeZone')];
  } catch {
    return ['UTC', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Tokyo',
      'Asia/Seoul', 'Asia/Singapore', 'Asia/Kolkata', 'Asia/Dubai', 'Europe/London',
      'Europe/Paris', 'Europe/Berlin', 'America/New_York', 'America/Chicago',
      'America/Denver', 'America/Los_Angeles', 'Australia/Sydney', 'Pacific/Auckland'];
  }
}

const browserTimezones = supportedTimezones();

export function PersonalProactivitySetting({ zh }: { zh: boolean }) {
  const [settings, setSettings] = useState<PersonalProactivitySettings>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [timezoneQuery, setTimezoneQuery] = useState('');
  const normalizedTimezoneQuery = timezoneQuery.trim().toLowerCase().replaceAll('_', ' ');
  const timezoneOptions = [...new Set([...browserTimezones, settings?.timezone].filter((value): value is string => Boolean(value)))].sort()
    .filter(timezone => timezone.replaceAll('_', ' ').toLowerCase().includes(normalizedTimezoneQuery))
    .map(timezone => ({ value: timezone, label: timezone.replaceAll('_', ' '), group: timezone.split('/')[0] }));
  useEffect(() => {
    let active = true;
    void fetchJson<{ ok: boolean; payload: unknown }>(apiUrl('/api/personal-agent/proactivity')).then(response => {
      if (active && response.ok) setSettings(PersonalProactivitySettingsSchema.parse(response.payload));
    }).catch(cause => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, []);
  async function save(patch: Partial<PersonalProactivitySettings>) {
    if (!settings || busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetchJson<{ ok: boolean; payload: unknown }>(apiUrl('/api/personal-agent/proactivity'), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...settings, ...patch }),
      });
      if (response.ok) setSettings(PersonalProactivitySettingsSchema.parse(response.payload));
    } catch (cause) {
      setError(String(cause));
      const response = await fetchJson<{ ok: boolean; payload: unknown }>(apiUrl('/api/personal-agent/proactivity')).catch(() => null);
      if (response?.ok) setSettings(PersonalProactivitySettingsSchema.parse(response.payload));
    } finally { setBusy(false); }
  }
  return <section className="space-y-3 border-t border-edge pt-5">
    <h3 className="text-sm font-medium text-fg">{zh ? '主动联系' : 'Proactive messages'}</h3>
    {!settings && !error ? <Skeleton className="h-9 w-full" /> : settings && <>
      <PopoverSelect placeholder={zh ? '选择主动方式' : 'Choose participation'} value={settings.mode} disabled={busy} allowEmpty={false} options={[
        { value: 'off', label: zh ? '关闭主动联系' : 'Off' },
        { value: 'follow_up', label: zh ? '仅明确跟进' : 'Requested follow-ups' },
        { value: 'balanced', label: zh ? '适度主动' : 'Thoughtful participation' },
      ]} onChange={mode => void save({ mode: mode as PersonalProactivitySettings['mode'] })} />
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-fg-muted">{zh ? '静默开始' : 'Quiet from'}<PopoverSelect placeholder={zh ? '选择时间' : 'Choose time'} value={String(settings.quietStart)} disabled={busy} allowEmpty={false}
          options={Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: `${String(hour).padStart(2, '0')}:00` }))}
          onChange={hour => void save({ quietStart: Number(hour) })} /></label>
        <label className="text-xs text-fg-muted">{zh ? '静默结束' : 'Quiet until'}<PopoverSelect placeholder={zh ? '选择时间' : 'Choose time'} value={String(settings.quietEnd)} disabled={busy} allowEmpty={false}
          options={Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: `${String(hour).padStart(2, '0')}:00` }))}
          onChange={hour => void save({ quietEnd: Number(hour) })} /></label>
      </div>
      <label className="block text-xs text-fg-muted">{zh ? '时区' : 'Timezone'}<PopoverSelect
        placeholder={zh ? '选择时区' : 'Choose timezone'}
        ariaLabel={zh ? '时区' : 'Timezone'}
        value={settings.timezone}
        selectedLabel={settings.timezone.replaceAll('_', ' ')}
        options={timezoneOptions}
        disabled={busy}
        allowEmpty={false}
        triggerClassName="mt-1"
        searchPlaceholder={zh ? '搜索时区或城市' : 'Search timezone or city'}
        searchValue={timezoneQuery}
        onSearchChange={setTimezoneQuery}
        statusMessage={timezoneOptions.length ? undefined : zh ? '没有匹配的时区' : 'No matching timezones'}
        onChange={timezone => {
          setTimezoneQuery('');
          if (timezone !== settings.timezone) void save({ timezone });
        }} /></label>
      <p className="text-xs text-fg-muted">{zh ? '有值得交流的进展时，在聊天里留下消息。明确请求的结果会照常交付。' : 'Useful developments appear in this chat. Requested results are delivered as usual.'}</p>
    </>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </section>;
}

import type { ProactiveCopy } from './copy';
import type { ProactivePreferences } from '@xopcai/gateway-contract';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';

import { DeliverySettings } from './delivery-controls';
import { proactiveWrite } from './api';

const inputClass = 'mt-1 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg';

export function ProactivePreferencesForm({ preferences, copy, refresh }: { preferences: ProactivePreferences; copy: ProactiveCopy; refresh: () => void }) {
  const [draft, setDraft] = useState(preferences);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save(patch: Partial<ProactivePreferences> = draft) {
    setBusy(true); setMessage('');
    try {
      const { revision: _revision, ...values } = { ...draft, ...patch };
      await proactiveWrite('/api/proactive/preferences', 'PATCH', { ...values, expectedRevision: preferences.revision });
      setMessage(copy.saved); refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <form className="max-w-2xl space-y-5 rounded-2xl border border-edge bg-surface-panel p-5" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <label className="block text-sm">{copy.level}<Select value={draft.level} onChange={(event) => setDraft({ ...draft, level: event.target.value as ProactivePreferences['level'] })}>{Object.entries(copy.levels).map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select></label>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm">{copy.timezone}<input required className={inputClass} value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} /></label>
      <label className="text-sm">{copy.limit}<input required type="number" min={0} max={30} className={inputClass} value={draft.dailyNotificationLimit} onChange={(e) => setDraft({ ...draft, dailyNotificationLimit: Number(e.target.value) })} /></label>
      <label className="text-sm">{copy.quietStart}<input required type="number" min={0} max={23} className={inputClass} value={draft.quietStartHour} onChange={(e) => setDraft({ ...draft, quietStartHour: Number(e.target.value) })} /></label>
      <label className="text-sm">{copy.quietEnd}<input required type="number" min={0} max={23} className={inputClass} value={draft.quietEndHour} onChange={(e) => setDraft({ ...draft, quietEndHour: Number(e.target.value) })} /></label>
    </div>
    <DeliverySettings value={draft} onChange={setDraft} zh={copy.locale === 'zh'} />
    <p className="text-sm text-fg-muted">{copy.privacy}</p>
    <div className="flex flex-wrap gap-2"><Button type="submit" variant="primary" disabled={busy}>{copy.save}</Button><Button disabled={busy} onClick={() => void save({ pausedUntil: new Date(Date.now() + 3600000).toISOString() })}>{copy.pause}</Button>{preferences.pausedUntil && <Button disabled={busy} onClick={() => void save({ pausedUntil: null })}>{copy.resume}</Button>}</div>
    {message && <p role="status" className="text-sm">{message}</p>}
  </form>;
}

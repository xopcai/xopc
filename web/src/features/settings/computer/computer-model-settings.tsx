import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CONFIGURED_MODELS_SWR_KEY, fetchConfiguredModelsCached } from '@/features/chat/api/registry-api';
import { ModelSelector } from '@/features/chat/model/model-selector';
import { messages } from '@/i18n/messages';

import { fetchGlobalDefaults, updateGlobalDefaults } from '../global-defaults-api';

/** Both settings destinations edit the same global binding and SWR cache. */
export function ComputerModelSettings({ zh }: { zh: boolean }) {
  const t = messages(zh ? 'zh' : 'en').computerSettings;
  const defaults = useSWR('settings-agent-defaults', fetchGlobalDefaults);
  const registry = useSWR(CONFIGURED_MODELS_SWR_KEY, fetchConfiguredModelsCached);
  const saved = defaults.data?.defaults.models.computerUse?.primary ?? '';
  const [model, setModel] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedNotice, setSavedNotice] = useState(false);
  useEffect(() => { setModel(saved); }, [saved]);
  const compatible = !model || registry.data?.some(entry => entry.id === model && entry.computerUse);

  const save = async () => {
    setBusy(true); setError(''); setSavedNotice(false);
    try {
      if (!compatible) throw new Error(t.modelUnavailable);
      const latest = await fetchGlobalDefaults();
      const models = { ...latest.defaults.models };
      if (model) models.computerUse = { primary: model, fallbacks: [] };
      else delete models.computerUse;
      const next = await updateGlobalDefaults({ ...latest.defaults, models });
      await defaults.mutate(next, false);
      setSavedNotice(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  return <section aria-label={t.model} className="space-y-3">
    <h2 className="text-sm font-semibold text-fg">{t.model}</h2>
    {!defaults.data && !defaults.error ? <Skeleton className="h-52 w-full rounded-xl" /> : defaults.error ?
      <div role="alert" className="text-sm text-danger">{String(defaults.error)}<Button onClick={() => { void defaults.mutate().catch(() => {}); }}>{t.retry}</Button></div> :
      <div className="space-y-4 rounded-xl border border-edge p-4 sm:p-5">
        <p className="text-sm text-fg-muted">{t.modelDescription}</p>
        <p className="text-xs leading-relaxed text-fg-muted">{t.modelScope}</p>
        {registry.isLoading ? <Skeleton className="h-10 w-full rounded-lg" /> : <ModelSelector
          value={model} onChange={value => { setModel(value); setSavedNotice(false); }} disabled={busy}
          capabilitiesFilter="computer-use" models={registry.data ?? []} modelsError={registry.error}
          placeholder={t.selectModel} searchPlaceholder={t.searchModel} noMatches={t.noModels}
          registryEmptyHint={t.noModels} allowEmpty emptyLabel={t.noModel} ariaLabel={t.modelLabel}
          className="w-full" contentAlign="start" />}
        {!compatible && !registry.isLoading && !registry.error && <p role="status" className="text-sm text-warning">{t.modelUnavailable}</p>}
        {registry.error && <p role="alert" className="text-sm text-danger">{String(registry.error)}<Button onClick={() => { void registry.mutate().catch(() => {}); }}>{t.retry}</Button></p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={busy || model === saved || !compatible || Boolean(registry.error) || registry.isLoading} onClick={() => { void save(); }}>{t.saveModel}</Button>
          <Button asChild variant="ghost"><Link to="/settings/capabilities/models?add=1">{t.manageModels}</Link></Button>
          {savedNotice && <span role="status" className="text-xs text-fg-muted">{t.modelSaved}</span>}
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>}
    <p className="text-xs leading-relaxed text-fg-muted">{t.modelPrivacy}</p>
  </section>;
}

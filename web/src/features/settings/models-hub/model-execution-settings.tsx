import { useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';

import { AutosaveStatus } from '@/components/ui/autosave-status';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchGlobalDefaults, updateGlobalDefaults } from '../global-defaults-api';
import type { AgentDefaults } from '../types/agent-gateway';
import { useAutosave } from '@/lib/use-autosave';
import { revalidateModelsHubCaches } from './models-hub-cache';
import { ModelExecutionSettingsFields } from './model-execution-settings-fields';

type Capability = 'chat' | 'vision' | 'image';

export function ModelExecutionSettings(props: { capability: Capability; zh: boolean; disabled: boolean; onPendingChange: (pending: boolean) => void }) {
  const { data, error } = useSWR('settings-agent-defaults', fetchGlobalDefaults);
  if (error && !data) return <p role="alert" className="text-sm text-danger">{String(error)}</p>;
  if (!data) return <Skeleton className="h-32 rounded-xl" />;
  return <ExecutionEditor key={JSON.stringify(data.defaults.models)} {...props} initial={data.defaults} />;
}

function ExecutionEditor({ initial, capability, zh, disabled, onPendingChange }: {
  initial: AgentDefaults; capability: Capability; zh: boolean; disabled: boolean; onPendingChange: (pending: boolean) => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(initial));
  const [saved, setSaved] = useState(() => structuredClone(initial));
  const dirty = JSON.stringify(draft.models) !== JSON.stringify(saved.models);
  const save = useCallback(async (snapshot: AgentDefaults) => {
    const latest = await fetchGlobalDefaults();
    if (JSON.stringify(latest.defaults.models) !== JSON.stringify(initial.models)) {
      throw new Error(zh ? '模型设置已变化，请刷新后重试。' : 'Model settings changed. Refresh before retrying.');
    }
    const result = await updateGlobalDefaults({ ...latest.defaults, models: snapshot.models }, { scope: 'models', expectedModels: initial.models });
    setSaved(result.defaults);
    await revalidateModelsHubCaches();
  }, [initial.models, zh]);
  const autosave = useAutosave({ value: draft, dirty, onSave: save, delayMs: 0 });
  const pending = dirty || autosave.status === 'saving' || Boolean(autosave.error);
  useEffect(() => { onPendingChange(pending); return () => onPendingChange(false); }, [pending, onPendingChange]);
  return <fieldset disabled={disabled || autosave.status === 'saving'} onBlurCapture={autosave.onBlurCapture} className="min-w-0 space-y-3">
    <AutosaveStatus status={autosave.status} error={autosave.error} />
    {autosave.error ? <Button variant="secondary" onClick={autosave.retry}>{zh ? '重试保存' : 'Retry saving'}</Button> : null}
    <ModelExecutionSettingsFields capability={capability} draft={draft} setDraft={setDraft} zh={zh} />
  </fieldset>;
}

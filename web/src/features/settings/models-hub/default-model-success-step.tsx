import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle2, Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { mutate } from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchConfiguredModelsCached, type ConfiguredModel } from '@/features/chat/api/registry-api';
import { ModelSelector } from '@/features/chat/model/model-selector';
import { fetchGlobalDefaults, updateGlobalDefaults, type GlobalDefaultsPayload } from '@/features/settings/global-defaults-api';
import { defaultModelCandidates, type DefaultModelTarget } from './default-model-candidates';

/** Success content rendered inside the existing provider dialog. */
export function DefaultModelSuccessStep({ target, zh, onDone }: {
  target: DefaultModelTarget;
  zh: boolean;
  onDone: () => void;
}) {
  const [data, setData] = useState<{ models: ConfiguredModel[]; defaults: GlobalDefaultsPayload } | null>(null);
  const [model, setModel] = useState('');
  const [imageModel, setImageModel] = useState('');
  const [updateChat, setUpdateChat] = useState(true);
  const [updateVision, setUpdateVision] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([fetchConfiguredModelsCached(true), fetchGlobalDefaults()]).then(([models, defaults]) => {
      if (!active) return;
      const candidates = defaultModelCandidates(models, target);
      setData({ models: candidates, defaults });
      setModel(candidates.length === 1 ? candidates[0].id : '');
      const vision = candidates.filter(candidate => candidate.vision);
      setImageModel(vision.length === 1 ? vision[0].id : '');
      setError('');
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
  }, [target, attempt]);

  const current = data?.defaults.defaults.models.chat.primary ?? '';
  const visionModels = data?.models.filter(candidate => candidate.vision) ?? [];
  const currentVision = data?.defaults.defaults.models.imageUnderstanding?.primary ?? '';
  const alreadyDefault = Boolean(model && model === current);
  const canUpdateVision = visionModels.some(candidate => candidate.id !== currentVision);
  const finished = updated || (alreadyDefault && !canUpdateVision) || (data !== null && data.models.length === 0);
  const canSave = Boolean(data && (updateChat || updateVision)
    && (!updateChat || model) && (!updateVision || imageModel)
    && ((updateChat && model !== current) || (updateVision && imageModel !== currentVision)));
  const save = async () => {
    if (busy || !data || !canSave) return;
    setBusy(true);
    setError('');
    try {
      const latest = await fetchGlobalDefaults();
      const registry = await fetchConfiguredModelsCached(true);
      const candidates = defaultModelCandidates(registry, target);
      if ((updateChat && !candidates.some(candidate => candidate.id === model))
        || (updateVision && !candidates.some(candidate => candidate.id === imageModel && candidate.vision))) {
        throw new Error(zh ? '所选模型已不可用，请重新选择。' : 'The selected model is no longer available. Choose another model.');
      }
      const next = await updateGlobalDefaults({ ...latest.defaults, models: {
        ...latest.defaults.models,
        ...(updateChat ? { chat: { ...latest.defaults.models.chat, primary: model } } : {}),
        ...(updateVision ? { imageUnderstanding: {
          ...latest.defaults.models.imageUnderstanding,
          primary: imageModel,
          fallbacks: latest.defaults.models.imageUnderstanding?.fallbacks ?? [],
        } } : {}),
      } });
      setUpdated(true);
      setData({ ...data, defaults: next });
      void mutate('settings-agent-defaults', next, false).catch(() => {});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!updated) return;
    const timeout = window.setTimeout(onDone, 600);
    return () => window.clearTimeout(timeout);
  }, [updated, onDone]);

  return <>
    <div className="flex shrink-0 items-start justify-between gap-4 px-5 py-5">
      <div>
        <p className="mb-3 flex items-center gap-2 text-sm text-fg-muted"><CheckCircle2 className="size-4" aria-hidden />{zh ? '模型配置完成' : 'Model configuration saved'}</p>
        <Dialog.Title className="text-base font-semibold text-fg">{updated
          ? (updateVision ? (zh ? '全局默认模型配置已更新' : 'Global default models updated') : (zh ? '全局默认对话模型已更新' : 'Global default conversation model updated'))
          : alreadyDefault && !canUpdateVision ? (zh ? '已是全局默认对话模型' : 'Already the global default conversation model')
          : finished ? (zh ? '配置已保存' : 'Configuration saved')
          : visionModels.length > 0 ? (zh ? '设置全局默认模型' : 'Set global default models')
          : current ? (zh ? '将新模型设为全局默认对话模型？' : 'Use a new model as the global default?')
          : (zh ? '设置默认对话模型' : 'Set the default conversation model')}</Dialog.Title>
        <Dialog.Description className="mt-2 text-sm text-fg-muted">{zh
          ? '继承全局设置的智能体和未配置专用模型的任务将使用它。已单独指定模型的智能体和会话继续使用各自设置。'
          : 'Agents inheriting global settings and tasks without a dedicated model use this default. Agents and conversations with their own model keep that selection.'}</Dialog.Description>
      </div>
      <Button variant="ghost" className="shrink-0 p-1.5" aria-label={zh ? '关闭' : 'Close'} onClick={onDone}><X className="size-4" /></Button>
    </div>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
      {!data && !error ? <Skeleton className="h-40 w-full rounded-xl" /> : null}
      {data && data.models.length > 0 ? <>
        {!updated && visionModels.length > 0 ? <label className="flex items-center gap-2 text-sm font-medium text-fg"><input type="checkbox" className="ui-checkbox" checked={updateChat} disabled={busy} onChange={event => { setUpdateChat(event.target.checked); setError(''); }} />{zh ? '更新默认对话模型' : 'Update default conversation model'}</label> : null}
        <div><p className="text-xs text-fg-muted">{zh ? '当前默认' : 'Current default'}</p><p className="mt-2 break-all text-sm text-fg">{current || (zh ? '尚未设置' : 'Not set')}</p></div>
        {!updated ? <div><p className="mb-2 text-xs text-fg-muted">{zh ? '新的默认' : 'New default'}</p>
          {data.models.length === 1 ? <p className="break-all text-sm text-fg">{model}</p> : <ModelSelector value={model} models={data.models} disabled={busy || !updateChat}
            placeholder={zh ? '选择默认模型' : 'Select a default model'} searchPlaceholder={zh ? '搜索模型' : 'Search models'}
            noMatches={zh ? '没有匹配的模型' : 'No matching models'} ariaLabel={zh ? '新的默认模型' : 'New default model'}
            className="w-full" contentAlign="start" onChange={value => { setModel(value); setError(''); }} />}
        </div> : null}
      </> : null}
      {!updated && visionModels.length > 0 ? <section className="space-y-3 rounded-xl border border-edge bg-surface-inset p-4">
        <label className="flex items-center gap-2 text-sm font-medium text-fg"><input type="checkbox" className="ui-checkbox" checked={updateVision} disabled={busy} onChange={event => { setUpdateVision(event.target.checked); setError(''); }} />{zh ? '同时设置图片理解模型' : 'Also set an image understanding model'}</label>
        <p className="text-xs text-fg-muted">{zh ? '用于图片和视觉内容理解。仅列出本次接入中支持图片理解的模型。' : 'Used for image and visual understanding. Only vision models from this addition are listed.'}</p>
        <p className="break-all text-xs text-fg-muted">{zh ? '当前配置：' : 'Current selection: '}{currentVision || (zh ? '未设置' : 'Not set')}</p>
        {updateVision ? <ModelSelector value={imageModel} models={visionModels} disabled={busy}
          placeholder={zh ? '选择图片理解模型' : 'Select an image understanding model'} searchPlaceholder={zh ? '搜索图片理解模型' : 'Search vision models'}
          noMatches={zh ? '没有可用的图片理解模型' : 'No vision models available'} ariaLabel={zh ? '图片理解模型' : 'Image understanding model'}
          className="w-full" contentAlign="start" onChange={value => { setImageModel(value); setError(''); }} /> : null}
      </section> : null}
      {data?.models.length === 0 ? <p className="text-sm text-fg-muted">{zh ? '此服务商暂无可设为默认的对话模型，可稍后在全局默认配置中设置。' : 'This provider has no conversation models to select yet. You can set the default later in global settings.'}</p> : null}
      {error ? <div role="alert" className="space-y-2 text-sm text-danger"><p>{zh ? '模型已保存，但默认模型设置未完成。' : 'The model is saved, but default model setup is incomplete.'}</p><p className="break-words">{error}</p>
        {!data ? <Button variant="secondary" onClick={() => { setError(''); setAttempt(value => value + 1); }}>{zh ? '重试' : 'Retry'}</Button> : null}</div> : null}
    </div>
    <div className="flex shrink-0 justify-end gap-2 border-t border-edge-subtle px-5 py-4">
      {finished ? <Button variant="primary" onClick={onDone}>{zh ? '完成' : 'Done'}</Button> : <>
        <Button variant="ghost" onClick={onDone}>{zh ? '暂不更改' : 'Keep current default'}</Button>
        <Button variant="primary" disabled={!canSave || busy} onClick={() => void save()}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {busy ? (zh ? '保存中…' : 'Saving…') : error && data ? (zh ? '重试' : 'Retry') : updateVision ? (zh ? '保存默认配置' : 'Save default models') : current ? (zh ? '设为全局默认' : 'Set as global default') : (zh ? '设为默认并完成' : 'Set default and finish')}
        </Button>
      </>}
    </div>
  </>;
}

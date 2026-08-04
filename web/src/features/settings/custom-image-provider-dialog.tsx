import * as Dialog from '@radix-ui/react-dialog';
import { ArrowUpRight, Eye, Loader2, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { PopoverSelect } from '@/components/ui/popover-select';
import { SecretInput } from '@/components/ui/secret-input';
import { revealProviderApiKey } from '@/features/settings/providers-api';
import { cn } from '@/lib/cn';
import { isMaskedSecret } from '@/lib/is-masked-secret';
import { SETTINGS_SHELL_CONTENT_Z, SETTINGS_SHELL_OVERLAY_Z } from '@/lib/settings-shell-dialog-layer';
import { showToast } from '@/lib/toast';

import {
  deleteCustomImageProvider,
  saveCustomImageProvider,
  saveImageProviderCredential,
  testImageProvider,
  type CustomImageModel,
  type CustomImageProvider,
  type CustomImageProviderInput,
} from './image-generation-api';

type Language = 'en' | 'zh';

type ModelDraft = {
  original: CustomImageModel;
  id: string;
  name: string;
  maxCount: string;
  defaultCount: string;
  defaultSize: string;
  outputFormat: '' | 'png' | 'jpeg' | 'webp';
  supportsSize: boolean;
  editEnabled: boolean;
};

const copy = {
  en: {
    addTitle: 'Add image service', editTitle: 'Manage image service', intro: 'Connect an endpoint that implements the OpenAI Images protocol.',
    connection: 'Connection', providerId: 'Provider ID', providerIdHint: 'Lowercase letters, numbers, hyphens, or underscores.', name: 'Display name', baseUrl: 'Base URL',
    auth: 'Authentication', bearer: 'Bearer token', header: 'Custom API key header', none: 'No authentication', headerName: 'Header name', apiKey: 'API key',
    apiKeyHint: 'Stored in the local credential store, separate from models.json.', apiKeyUrl: 'API key page (optional)', docsUrl: 'Documentation page (optional)', openKeyPage: 'Create API key',
    paths: 'Protocol and network', generationsPath: 'Generations path', editsPath: 'Edits path', allowedHosts: 'Allowed private hosts (optional)', allowedHostsHint: 'One exact hostname or IP per line. Private endpoints stay blocked unless listed here.', staticHeaders: 'Static headers (optional)', staticHeadersHint: 'One per line: X-Tenant: value. Credential headers are rejected.',
    models: 'Image models', addModel: 'Add model', modelId: 'Model ID', modelName: 'Name (optional)', defaultModel: 'Default model', maxCount: 'Max images', defaultCount: 'Default count', defaultSize: 'Default size', format: 'Output format', supportsSize: 'Supports size', edit: 'Supports edits', remove: 'Remove',
    cancel: 'Cancel', save: 'Save service', saving: 'Saving…', test: 'Test generation', testing: 'Generating…', delete: 'Delete service', confirmDelete: 'Delete permanently', saved: 'Image service saved.', deleted: 'Image service deleted.', testReady: 'Test image generated.',
    show: 'Show key', hide: 'Hide key', copy: 'Copy key', copied: 'Copied', revealFailed: 'Unable to reveal the saved key.', notRevealable: 'No revealable key is stored locally.', required: 'Complete the required connection and model fields.', duplicateModels: 'Model IDs must be unique.', invalidHeaders: 'Static headers must use “Name: value”, one per line.',
  },
  zh: {
    addTitle: '添加图片服务', editTitle: '管理图片服务', intro: '连接一个严格实现 OpenAI Images 协议的服务端点。',
    connection: '连接信息', providerId: 'Provider ID', providerIdHint: '仅支持小写字母、数字、连字符和下划线。', name: '显示名称', baseUrl: 'Base URL',
    auth: '认证方式', bearer: 'Bearer Token', header: '自定义 API Key Header', none: '无需认证', headerName: 'Header 名称', apiKey: 'API Key',
    apiKeyHint: '密钥单独保存在本机凭据存储，不写入 models.json。', apiKeyUrl: 'API Key 创建页面（可选）', docsUrl: '协议文档页面（可选）', openKeyPage: '去创建 API Key',
    paths: '协议与网络', generationsPath: '生成路径', editsPath: '编辑路径', allowedHosts: '允许访问的私有主机（可选）', allowedHostsHint: '每行一个精确主机名或 IP；未列出的私网端点保持阻止。', staticHeaders: '静态 Headers（可选）', staticHeadersHint: '每行一个：X-Tenant: value。认证 Header 会被拒绝。',
    models: '图片模型', addModel: '添加模型', modelId: '模型 ID', modelName: '名称（可选）', defaultModel: '默认模型', maxCount: '单次最大张数', defaultCount: '默认张数', defaultSize: '默认尺寸', format: '输出格式', supportsSize: '支持尺寸参数', edit: '支持图片编辑', remove: '移除',
    cancel: '取消', save: '保存服务', saving: '保存中…', test: '测试生成', testing: '生成中…', delete: '删除服务', confirmDelete: '确认永久删除', saved: '图片服务已保存。', deleted: '图片服务已删除。', testReady: '测试图片生成成功。',
    show: '显示密钥', hide: '隐藏密钥', copy: '复制密钥', copied: '已复制', revealFailed: '无法查看已保存的密钥。', notRevealable: '本机没有可查看的密钥。', required: '请补全必填的连接和模型信息。', duplicateModels: '模型 ID 不能重复。', invalidHeaders: '静态 Header 必须使用“名称: 值”格式，每行一个。',
  },
} as const;

const inputClass = 'mt-1.5 h-10 w-full rounded-lg border border-edge bg-surface-panel px-3 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20';

function modelDraft(model?: CustomImageModel): ModelDraft {
  const source = model ?? { id: '', capabilities: { generate: { maxCount: 1, supportsSize: true }, edit: { enabled: false } } };
  return {
    original: source,
    id: source.id,
    name: source.name ?? '',
    maxCount: String(source.capabilities.generate?.maxCount ?? 1),
    defaultCount: source.defaults?.count ? String(source.defaults.count) : '',
    defaultSize: source.defaults?.size ?? '',
    outputFormat: source.defaults?.outputFormat ?? '',
    supportsSize: source.capabilities.generate?.supportsSize ?? false,
    editEnabled: source.capabilities.edit?.enabled ?? false,
  };
}

function parseHeaders(value: string): Record<string, string> | undefined {
  const lines = value.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return undefined;
  const entries = lines.map((line) => {
    const separator = line.indexOf(':');
    if (separator <= 0 || !line.slice(separator + 1).trim()) throw new Error('invalid_headers');
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] as const;
  });
  return Object.fromEntries(entries);
}

export function CustomImageProviderDialog({
  open,
  onOpenChange,
  provider,
  configured,
  language,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider?: CustomImageProvider;
  configured: boolean;
  language: Language;
  onSaved: (providerId?: string) => Promise<void> | void;
}) {
  const text = copy[language];
  const [providerId, setProviderId] = useState('');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [authType, setAuthType] = useState<'bearer' | 'header' | 'none'>('bearer');
  const [headerName, setHeaderName] = useState('x-api-key');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyUrl, setApiKeyUrl] = useState('');
  const [documentationUrl, setDocumentationUrl] = useState('');
  const [generationsPath, setGenerationsPath] = useState('/images/generations');
  const [editsPath, setEditsPath] = useState('/images/edits');
  const [allowedHosts, setAllowedHosts] = useState('');
  const [headers, setHeaders] = useState('');
  const [models, setModels] = useState<ModelDraft[]>([modelDraft()]);
  const [defaultModel, setDefaultModel] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | 'delete'>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<string>();

  useEffect(() => {
    if (!open) return;
    const image = provider?.imageGeneration;
    setProviderId(provider?.providerId ?? '');
    setName(image?.name ?? '');
    setBaseUrl(provider?.baseUrl ?? '');
    setAuthType(image?.auth.type ?? 'bearer');
    setHeaderName(image?.auth.type === 'header' ? image.auth.headerName : 'x-api-key');
    setApiKey(configured ? '••••••••••••' : '');
    setApiKeyUrl(image?.apiKeyUrl ?? '');
    setDocumentationUrl(image?.documentationUrl ?? '');
    setGenerationsPath(image?.paths?.generations ?? '/images/generations');
    setEditsPath(image?.paths?.edits ?? '/images/edits');
    setAllowedHosts(image?.network?.allowedHosts.join('\n') ?? '');
    setHeaders(Object.entries(provider?.headers ?? {}).map(([key, value]) => `${key}: ${value}`).join('\n'));
    setModels(image?.models.map(modelDraft) ?? [modelDraft()]);
    setDefaultModel(image?.defaultModel ?? '');
    setBusy(undefined);
    setConfirmDelete(false);
    setError(undefined);
    setPreview(undefined);
  }, [configured, open, provider]);

  const modelOptions = useMemo(
    () => models.filter((model) => model.id.trim()).map((model) => ({ value: model.id.trim(), label: model.name.trim() || model.id.trim() })),
    [models],
  );

  const updateModel = (index: number, patch: Partial<ModelDraft>) => {
    setModels((current) => current.map((model, modelIndex) => modelIndex === index ? { ...model, ...patch } : model));
  };

  const buildInput = (): { providerId: string; input: CustomImageProviderInput } => {
    const normalizedId = providerId.trim();
    const normalizedModels = models.map((model) => ({ ...model, id: model.id.trim(), name: model.name.trim() }));
    if (!normalizedId || !name.trim() || !baseUrl.trim() || normalizedModels.some((model) => !model.id)) {
      throw new Error(text.required);
    }
    if (new Set(normalizedModels.map((model) => model.id)).size !== normalizedModels.length) {
      throw new Error(text.duplicateModels);
    }
    const selectedDefault = defaultModel || normalizedModels[0]?.id;
    if (!selectedDefault || !normalizedModels.some((model) => model.id === selectedDefault)) {
      throw new Error(text.required);
    }
    let staticHeaders: Record<string, string> | undefined;
    try {
      staticHeaders = parseHeaders(headers);
    } catch {
      throw new Error(text.invalidHeaders);
    }
    return {
      providerId: normalizedId,
      input: {
        baseUrl: baseUrl.trim(),
        ...(staticHeaders ? { headers: staticHeaders } : {}),
        imageGeneration: {
          api: 'openai-images',
          name: name.trim(),
          ...(documentationUrl.trim() ? { documentationUrl: documentationUrl.trim() } : {}),
          ...(apiKeyUrl.trim() ? { apiKeyUrl: apiKeyUrl.trim() } : {}),
          defaultModel: selectedDefault,
          auth: authType === 'header'
            ? { type: 'header', headerName: headerName.trim() }
            : { type: authType },
          paths: {
            ...(generationsPath.trim() ? { generations: generationsPath.trim() } : {}),
            ...(editsPath.trim() ? { edits: editsPath.trim() } : {}),
          },
          ...(allowedHosts.trim()
            ? { network: { allowedHosts: allowedHosts.split('\n').map((host) => host.trim()).filter(Boolean) } }
            : {}),
          models: normalizedModels.map((model) => ({
            ...model.original,
            id: model.id,
            ...(model.name ? { name: model.name } : { name: undefined }),
            capabilities: {
              ...model.original.capabilities,
              generate: {
                ...model.original.capabilities.generate,
                maxCount: Math.max(1, Number.parseInt(model.maxCount, 10) || 1),
                supportsSize: model.supportsSize,
              },
              edit: {
                ...model.original.capabilities.edit,
                enabled: model.editEnabled,
              },
            },
            defaults: {
              ...model.original.defaults,
              ...(model.defaultCount ? { count: Math.max(1, Number.parseInt(model.defaultCount, 10) || 1) } : { count: undefined }),
              ...(model.defaultSize.trim() ? { size: model.defaultSize.trim() } : { size: undefined }),
              ...(model.outputFormat ? { outputFormat: model.outputFormat } : { outputFormat: undefined }),
            },
          })),
        },
      },
    };
  };

  const persist = async () => {
    const built = buildInput();
    await saveCustomImageProvider(built.providerId, built.input);
    if (authType !== 'none' && apiKey.trim() && !isMaskedSecret(apiKey)) {
      await saveImageProviderCredential(built.providerId, apiKey.trim());
    }
    await onSaved(built.providerId);
    return built;
  };

  const save = async () => {
    setBusy('save'); setError(undefined);
    try {
      await persist();
      setApiKey(authType === 'none' ? '' : '••••••••••••');
      showToast({ type: 'success', title: text.saved });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(undefined); }
  };

  const test = async () => {
    setBusy('test'); setError(undefined); setPreview(undefined);
    try {
      const built = await persist();
      const result = await testImageProvider(built.providerId, built.input.imageGeneration.defaultModel);
      setPreview(result.images[0]?.dataUrl);
      showToast({ type: 'success', title: text.testReady });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(undefined); }
  };

  const remove = async () => {
    if (!provider) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setBusy('delete'); setError(undefined);
    try {
      await deleteCustomImageProvider(provider.providerId);
      await onSaved();
      showToast({ type: 'success', title: text.deleted });
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(undefined); }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn('xopc-dialog-overlay fixed inset-0 bg-scrim', SETTINGS_SHELL_OVERLAY_Z)} />
        <Dialog.Content
          className={cn('xopc-dialog-content fixed left-1/2 top-1/2 flex h-[min(88vh,760px)] w-[min(calc(100%-2rem),52rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-popover', SETTINGS_SHELL_CONTENT_Z)}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-edge px-5 py-4">
            <div><Dialog.Title className="font-semibold text-fg">{provider ? text.editTitle : text.addTitle}</Dialog.Title><Dialog.Description className="mt-1 text-sm text-fg-muted">{text.intro}</Dialog.Description></div>
            <Dialog.Close asChild><button type="button" className="rounded-md p-1 text-fg-muted hover:bg-surface-subtle hover:text-fg" aria-label={text.cancel}><X className="size-5" /></button></Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
            <section className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{text.connection}</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-xs font-medium text-fg-muted">{text.providerId}<input value={providerId} disabled={Boolean(provider)} onChange={(event) => setProviderId(event.target.value)} placeholder="my-image-service" className={inputClass} /><span className="mt-1 block font-normal text-fg-subtle">{text.providerIdHint}</span></label>
                <label className="text-xs font-medium text-fg-muted">{text.name}<input value={name} onChange={(event) => setName(event.target.value)} placeholder="My Image Service" className={inputClass} /></label>
              </div>
              <label className="block text-xs font-medium text-fg-muted">{text.baseUrl}<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" className={inputClass} /></label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-xs font-medium text-fg-muted">{text.auth}<PopoverSelect value={authType} options={[{ value: 'bearer', label: text.bearer }, { value: 'header', label: text.header }, { value: 'none', label: text.none }]} placeholder={text.auth} allowEmpty={false} onChange={(value) => setAuthType(value as typeof authType)} triggerClassName="mt-1.5" /></label>
                {authType === 'header' ? <label className="text-xs font-medium text-fg-muted">{text.headerName}<input value={headerName} onChange={(event) => setHeaderName(event.target.value)} className={inputClass} /></label> : null}
              </div>
              {authType !== 'none' ? <div><div className="mb-1.5 flex items-center justify-between"><label htmlFor="custom-image-api-key" className="text-xs font-medium text-fg-muted">{text.apiKey}</label>{apiKeyUrl.trim() ? <a href={apiKeyUrl.trim()} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">{text.openKeyPage}<ArrowUpRight className="size-3.5" /></a> : null}</div><SecretInput id="custom-image-api-key" value={apiKey} onChange={(value) => setApiKey(isMaskedSecret(apiKey) ? value.replace(/^•+/, '') : value)} labels={{ show: text.show, hide: text.hide, copy: text.copy, copied: text.copied }} reveal={() => revealProviderApiKey(providerId).then((payload) => payload.apiKey)} loadFailedLabel={text.revealFailed} notInConfigFile={text.notRevealable} /><p className="mt-1 text-xs text-fg-subtle">{text.apiKeyHint}</p></div> : null}
              <div className="grid gap-4 md:grid-cols-2"><label className="text-xs font-medium text-fg-muted">{text.apiKeyUrl}<input value={apiKeyUrl} onChange={(event) => setApiKeyUrl(event.target.value)} placeholder="https://…" className={inputClass} /></label><label className="text-xs font-medium text-fg-muted">{text.docsUrl}<input value={documentationUrl} onChange={(event) => setDocumentationUrl(event.target.value)} placeholder="https://…" className={inputClass} /></label></div>
              <details className="rounded-lg border border-edge bg-surface-subtle px-3 py-2.5"><summary className="cursor-pointer text-sm font-medium text-fg-muted">{text.paths}</summary><div className="mt-3 grid gap-4 md:grid-cols-2"><label className="text-xs font-medium text-fg-muted">{text.generationsPath}<input value={generationsPath} onChange={(event) => setGenerationsPath(event.target.value)} className={inputClass} /></label><label className="text-xs font-medium text-fg-muted">{text.editsPath}<input value={editsPath} onChange={(event) => setEditsPath(event.target.value)} className={inputClass} /></label></div><label className="mt-4 block text-xs font-medium text-fg-muted">{text.allowedHosts}<textarea value={allowedHosts} onChange={(event) => setAllowedHosts(event.target.value)} rows={2} placeholder={'127.0.0.1\nimage-server.lan'} className="mt-1.5 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 font-mono text-xs text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" /><span className="mt-1 block font-normal text-fg-subtle">{text.allowedHostsHint}</span></label><label className="mt-4 block text-xs font-medium text-fg-muted">{text.staticHeaders}<textarea value={headers} onChange={(event) => setHeaders(event.target.value)} rows={3} className="mt-1.5 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 font-mono text-xs text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" /><span className="mt-1 block font-normal text-fg-subtle">{text.staticHeadersHint}</span></label></details>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between"><h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{text.models}</h3><Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setModels((current) => [...current, modelDraft()])}><Plus className="size-4" />{text.addModel}</Button></div>
              <label className="block text-xs font-medium text-fg-muted">{text.defaultModel}<PopoverSelect value={defaultModel || modelOptions[0]?.value || ''} options={modelOptions} placeholder={text.defaultModel} allowEmpty={false} onChange={setDefaultModel} triggerClassName="mt-1.5 max-w-sm" /></label>
              {models.map((model, index) => <div key={index} className="rounded-lg border border-edge bg-surface-base p-3"><div className="grid gap-3 md:grid-cols-2"><label className="text-xs font-medium text-fg-muted">{text.modelId}<input value={model.id} onChange={(event) => updateModel(index, { id: event.target.value })} placeholder="image-1" className={inputClass} /></label><label className="text-xs font-medium text-fg-muted">{text.modelName}<input value={model.name} onChange={(event) => updateModel(index, { name: event.target.value })} className={inputClass} /></label></div><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs font-medium text-fg-muted">{text.maxCount}<input type="number" min={1} value={model.maxCount} onChange={(event) => updateModel(index, { maxCount: event.target.value })} className={inputClass} /></label><label className="text-xs font-medium text-fg-muted">{text.defaultCount}<input type="number" min={1} value={model.defaultCount} onChange={(event) => updateModel(index, { defaultCount: event.target.value })} className={inputClass} /></label><label className="text-xs font-medium text-fg-muted">{text.defaultSize}<input value={model.defaultSize} onChange={(event) => updateModel(index, { defaultSize: event.target.value })} placeholder="1024x1024" className={inputClass} /></label><label className="text-xs font-medium text-fg-muted">{text.format}<PopoverSelect value={model.outputFormat} options={[{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' }, { value: 'webp', label: 'WebP' }]} placeholder={text.format} allowEmpty onChange={(value) => updateModel(index, { outputFormat: value as ModelDraft['outputFormat'] })} triggerClassName="mt-1.5" /></label></div><div className="mt-3 flex flex-wrap items-center gap-4"><label className="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={model.supportsSize} onChange={(event) => updateModel(index, { supportsSize: event.target.checked })} />{text.supportsSize}</label><label className="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={model.editEnabled} onChange={(event) => updateModel(index, { editEnabled: event.target.checked })} />{text.edit}</label><button type="button" disabled={models.length === 1} onClick={() => setModels((current) => current.filter((_, modelIndex) => modelIndex !== index))} className="ml-auto inline-flex items-center gap-1 text-xs text-red-600 disabled:opacity-40 dark:text-red-400"><Trash2 className="size-3.5" />{text.remove}</button></div></div>)}
            </section>

            {preview ? <section className="rounded-lg border border-edge bg-surface-base p-3"><div className="mb-2 flex items-center gap-2 text-sm font-medium text-fg"><Eye className="size-4" />{text.testReady}</div><img src={preview} alt="Generated provider test" className="max-h-72 rounded-lg object-contain" /></section> : null}
            {error ? <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
          </div>

          <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-edge px-5 py-3">
            {provider ? <Button variant="secondary" className="border-red-500/30 text-red-600 hover:bg-red-500/10 dark:text-red-400" disabled={Boolean(busy)} onClick={() => void remove()}>{busy === 'delete' ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}{confirmDelete ? text.confirmDelete : text.delete}</Button> : null}
            <div className="ml-auto flex gap-2"><Dialog.Close asChild><Button variant="secondary">{text.cancel}</Button></Dialog.Close><Button variant="secondary" disabled={Boolean(busy)} onClick={() => void test()}>{busy === 'test' ? <Loader2 className="size-4 animate-spin" /> : null}{busy === 'test' ? text.testing : text.test}</Button><Button variant="primary" disabled={Boolean(busy)} onClick={() => void save()}>{busy === 'save' ? <Loader2 className="size-4 animate-spin" /> : null}{busy === 'save' ? text.saving : text.save}</Button></div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

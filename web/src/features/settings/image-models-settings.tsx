import { ArrowUpRight, CheckCircle2, ImageIcon, KeyRound, Loader2, Plus, Settings2, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { PopoverSelect } from '@/components/ui/popover-select';
import { SecretInput } from '@/components/ui/secret-input';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchGatewayAgents } from '@/features/settings/agents-admin-api';
import { agentListDisplayName } from '@/features/settings/agents/agent-display-names';
import { CustomImageProviderDialog } from '@/features/settings/custom-image-provider-dialog';
import {
  fetchCustomImageProviders,
  fetchImageCatalog,
  type CustomImageProvider,
  type ImageProvider,
} from '@/features/settings/image-generation-api';
import { getOrderedApiKeyLinks } from '@/features/settings/provider-enrichment';
import { revealProviderApiKey } from '@/features/settings/providers-api';
import { fetchJson } from '@/lib/fetch';
import { isMaskedSecret } from '@/lib/is-masked-secret';
import { apiUrl } from '@/lib/url';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

type AgentImageGeneration = {
  agentId: string;
  model: { primary: string; fallbacks?: string[] } | null;
};

type SetupResult = {
  agent: AgentImageGeneration;
  providers: ImageProvider[];
  verification: { verified: boolean; supported: boolean; message?: string };
};

const MASKED_API_KEY = '••••••••••••';

const copy = {
  en: {
    title: 'Image generation',
    intro: 'Choose an agent and image model, or connect an OpenAI Images service of your own.',
    agent: 'Agent',
    provider: 'Provider',
    model: 'Model',
    apiKey: 'API key',
    getApiKey: 'Get API key',
    apiKeyHint: 'Stored in the local credential store, never in xopc.json.',
    existingKey: 'A credential or environment variable is already available. Leave this blank to reuse it.',
    savedKey: 'A credential is saved. Use the eye button to view it, or type a new key to replace it.',
    revealFailed: 'Unable to load the saved API key.',
    keyNotRevealable: 'This credential comes from an environment variable or another non-revealable source.',
    region: 'Service region',
    cn: 'China',
    intl: 'International',
    advanced: 'Custom endpoint',
    baseUrl: 'Base URL (optional)',
    enable: 'Enable image generation',
    enabling: 'Verifying and enabling…',
    enabled: 'Image generation is ready.',
    addService: 'Add image service',
    manageService: 'Manage service',
    custom: 'Custom',
    current: 'Current',
    configured: 'Credential ready',
    needsKey: 'API key required',
    connect: 'Connect to a gateway to continue.',
    loadError: 'Unable to load image generation settings.',
    selectAgent: 'Select an agent',
    selectModel: 'Select a model',
    show: 'Show key',
    hide: 'Hide key',
    copy: 'Copy key',
    copied: 'Copied',
  },
  zh: {
    title: '图片生成',
    intro: '为 Agent 选择图片模型，也可以连接你自己的 OpenAI Images 服务。',
    agent: 'Agent',
    provider: 'Provider',
    model: '模型',
    apiKey: 'API Key',
    getApiKey: '获取 API Key',
    apiKeyHint: '密钥只保存在本机凭据存储中，不会写入 xopc.json。',
    existingKey: '已有凭据或环境变量；留空即可继续使用。',
    savedKey: '凭据已保存。点击眼睛可查看，直接输入新密钥可替换。',
    revealFailed: '无法读取已保存的 API Key。',
    keyNotRevealable: '当前凭据来自环境变量或其他不可查看的来源。',
    region: '服务地域',
    cn: '中国站',
    intl: '国际站',
    advanced: '自定义服务地址',
    baseUrl: 'Base URL（可选）',
    enable: '启用图片生成',
    enabling: '正在验证并启用…',
    enabled: '图片生成已可用。',
    addService: '添加图片服务',
    manageService: '管理服务',
    custom: '自定义',
    current: '当前使用',
    configured: '凭据已就绪',
    needsKey: '需要 API Key',
    connect: '请先连接网关。',
    loadError: '无法加载图片生成设置。',
    selectAgent: '选择 Agent',
    selectModel: '选择模型',
    show: '显示密钥',
    hide: '隐藏密钥',
    copy: '复制密钥',
    copied: '已复制',
  },
} as const;

async function fetchAgentImageGeneration(agentId: string): Promise<AgentImageGeneration> {
  const response = await fetchJson<{ payload?: AgentImageGeneration }>(
    apiUrl(`/api/agents/${encodeURIComponent(agentId)}/image-generation`),
  );
  if (!response.payload) throw new Error('Invalid agent image generation response');
  return response.payload;
}

function providerIdFromModel(model: string | undefined): string | undefined {
  const slash = model?.indexOf('/') ?? -1;
  return slash > 0 ? model!.slice(0, slash) : undefined;
}

function modelIdFromRef(model: string | undefined): string | undefined {
  const slash = model?.indexOf('/') ?? -1;
  return slash > 0 ? model!.slice(slash + 1) : undefined;
}

function providerEnrichmentId(providerId: string, region: 'cn' | 'intl'): string {
  if (providerId === 'minimax') return region === 'cn' ? 'minimax-cn' : 'minimax';
  if (providerId === 'dashscope') return region === 'cn' ? 'dashscope-cn' : 'dashscope-intl';
  return providerId;
}

function ImageSettingsSkeleton() {
  return (
    <div className="grid gap-4" aria-hidden="true">
      <Skeleton className="h-24 rounded-xl" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

export function ImageModelsSettingsPanel() {
  const language = useLocaleStore((state) => state.language);
  const text = copy[language];
  const commonMessages = messages(language);
  const hasToken = Boolean(useGatewayStore((state) => state.token));
  const [agentId, setAgentId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [modelId, setModelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [region, setRegion] = useState<'cn' | 'intl'>(language === 'zh' ? 'cn' : 'intl');
  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [editingCustomProvider, setEditingCustomProvider] = useState<CustomImageProvider>();

  const { data: agents, isLoading: agentsLoading, error: agentsError } = useSWR(
    hasToken ? 'image-generation-agents' : null,
    fetchGatewayAgents,
    { revalidateOnFocus: false },
  );
  const { data: providers, isLoading: providersLoading, error: providersError, mutate: mutateProviders } = useSWR(
    hasToken ? apiUrl('/api/image-generation/catalog') : null,
    fetchImageCatalog,
    { revalidateOnFocus: false },
  );
  const { data: customProviders, isLoading: customProvidersLoading, error: customProvidersError, mutate: mutateCustomProviders } = useSWR(
    hasToken ? apiUrl('/api/image-generation/custom-providers') : null,
    fetchCustomImageProviders,
    { revalidateOnFocus: false },
  );

  useEffect(() => {
    if (!agents || agentId) return;
    setAgentId(agents.defaultId || agents.agents[0]?.id || '');
  }, [agentId, agents]);

  const { data: agentConfig, isLoading: agentConfigLoading, error: agentConfigError, mutate: mutateAgentConfig } = useSWR(
    hasToken && agentId ? ['agent-image-generation', agentId] : null,
    () => fetchAgentImageGeneration(agentId),
    { revalidateOnFocus: false },
  );

  useEffect(() => {
    if (!providers || !agentConfig) return;
    const currentProviderId = providerIdFromModel(agentConfig.model?.primary);
    const selected = providers.find((provider) => provider.id === currentProviderId)
      ?? providers.find((provider) => provider.configured)
      ?? providers[0];
    if (!selected) return;
    setProviderId(selected.id);
    setModelId(
      selected.id === currentProviderId
        ? modelIdFromRef(agentConfig.model?.primary) || selected.defaultModel
        : selected.defaultModel,
    );
    setApiKey(selected.configured ? MASKED_API_KEY : '');
  }, [agentConfig, providers]);

  useEffect(() => {
    setError(undefined);
  }, [agentId]);

  const selectedProvider = providers?.find((provider) => provider.id === providerId);
  const apiKeyUrl = selectedProvider
    ? selectedProvider.apiKeyUrl
      ?? getOrderedApiKeyLinks(providerEnrichmentId(selectedProvider.id, region), language)[0]?.href
    : undefined;
  const agentOptions = useMemo(
    () => (agents?.agents ?? []).map((agent) => ({
      value: agent.id,
      label: agentListDisplayName(agent, commonMessages.agentsSettings),
    })),
    [agents?.agents, commonMessages.agentsSettings],
  );
  const modelOptions = useMemo(
    () => (selectedProvider?.models ?? []).map((model) => ({ value: model, label: model })),
    [selectedProvider?.models],
  );
  const currentRef = agentConfig?.model?.primary;
  const canSubmit = Boolean(
    agentId
      && selectedProvider
      && modelId
      && (selectedProvider.credentialMode !== 'api-key' || selectedProvider.configured || apiKey.trim()),
  );

  if (!hasToken) return <p className="text-sm text-fg-muted">{text.connect}</p>;
  if (agentsLoading || providersLoading || customProvidersLoading || agentConfigLoading) return <ImageSettingsSkeleton />;
  if (agentsError || providersError || customProvidersError || agentConfigError || !providers || !agents || !customProviders) {
    return <p className="text-sm text-red-600 dark:text-red-400">{text.loadError}</p>;
  }

  const chooseProvider = (provider: ImageProvider) => {
    setProviderId(provider.id);
    setModelId(provider.defaultModel);
    setApiKey(provider.configured ? MASKED_API_KEY : '');
    setBaseUrl('');
    setError(undefined);
  };

  const openNewCustomProvider = () => {
    setEditingCustomProvider(undefined);
    setCustomDialogOpen(true);
  };

  const openSelectedCustomProvider = () => {
    const custom = customProviders.find((provider) => provider.providerId === selectedProvider?.id);
    if (!custom) return;
    setEditingCustomProvider(custom);
    setCustomDialogOpen(true);
  };

  const refreshCustomProviders = async (nextProviderId?: string) => {
    const [nextCustom, nextCatalog] = await Promise.all([
      mutateCustomProviders(),
      mutateProviders(),
    ]);
    if (nextProviderId && nextCatalog?.some((provider) => provider.id === nextProviderId)) {
      const next = nextCatalog.find((provider) => provider.id === nextProviderId)!;
      setProviderId(next.id);
      setModelId(next.defaultModel);
      setApiKey(next.configured ? MASKED_API_KEY : '');
      setEditingCustomProvider(nextCustom?.find((provider) => provider.providerId === nextProviderId));
    }
  };

  const submit = async () => {
    if (!selectedProvider || !canSubmit) return;
    setSaving(true);
    setError(undefined);
    setSaved(false);
    try {
      const response = await fetchJson<{ payload?: SetupResult }>(
        apiUrl(`/api/agents/${encodeURIComponent(agentId)}/image-generation/setup`),
        {
          method: 'POST',
          body: JSON.stringify({
            providerId: selectedProvider.id,
            modelId,
            ...(apiKey.trim() && !isMaskedSecret(apiKey) ? { apiKey: apiKey.trim() } : {}),
            ...(selectedProvider.requiresRegion ? { region } : {}),
            ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
          }),
        },
      );
      if (!response.payload) throw new Error('Invalid setup response');
      await Promise.all([
        mutateAgentConfig(response.payload.agent, { revalidate: false }),
        mutateProviders(response.payload.providers, { revalidate: false }),
      ]);
      setApiKey(MASKED_API_KEY);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl border border-edge bg-surface-base p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-accent/10 p-2 text-accent"><ImageIcon className="size-5" /></div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-fg">{text.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-fg-muted">{text.intro}</p>
          </div>
        </div>
        <label className="mt-4 block text-xs font-medium text-fg-muted">
          {text.agent}
          <PopoverSelect
            value={agentId}
            options={agentOptions}
            placeholder={text.selectAgent}
            allowEmpty={false}
            onChange={setAgentId}
            triggerClassName="mt-1.5 max-w-md"
          />
        </label>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{text.provider}</h3>
          <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={openNewCustomProvider}>
            <Plus className="size-4" />{text.addService}
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {providers.map((provider) => {
            const selected = provider.id === providerId;
            const active = provider.id === providerIdFromModel(currentRef);
            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => chooseProvider(provider)}
                className={`min-h-24 rounded-xl border p-4 text-left transition-colors ${selected ? 'border-accent bg-accent/5 ring-1 ring-accent/20' : 'border-edge bg-surface-base hover:border-edge-strong'}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium text-fg">{provider.label}</span>
                    {provider.source === 'custom' ? <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-[10px] text-fg-subtle">{text.custom}</span> : null}
                  </span>
                  <span
                    aria-hidden={!active}
                    className={`shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent ${active ? '' : 'invisible'}`}
                  >
                    {text.current}
                  </span>
                </span>
                <span className={`mt-2 flex items-center gap-1.5 text-xs ${provider.configured ? 'text-emerald-600 dark:text-emerald-400' : 'text-fg-muted'}`}>
                  {provider.configured || provider.credentialMode !== 'api-key' ? <CheckCircle2 className="size-3.5" /> : <KeyRound className="size-3.5" />}
                  {provider.configured || provider.credentialMode !== 'api-key' ? text.configured : text.needsKey}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {selectedProvider ? (
        <section className="rounded-xl border border-edge bg-surface-base p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-xs font-medium text-fg-muted">
              {text.model}
              <PopoverSelect
                value={modelId}
                options={modelOptions}
                placeholder={text.selectModel}
                allowEmpty={false}
                onChange={setModelId}
                triggerClassName="mt-1.5"
              />
            </label>
            {selectedProvider.requiresRegion ? (
              <label className="block text-xs font-medium text-fg-muted">
                {text.region}
                <PopoverSelect
                  value={region}
                  options={[{ value: 'cn', label: text.cn }, { value: 'intl', label: text.intl }]}
                  placeholder={text.region}
                  allowEmpty={false}
                  onChange={(value) => setRegion(value as 'cn' | 'intl')}
                  triggerClassName="mt-1.5"
                />
              </label>
            ) : null}
          </div>

          {selectedProvider.source === 'custom' ? (
            <div className="mt-4 flex justify-end">
              <Button variant="secondary" onClick={openSelectedCustomProvider}>
                <Settings2 className="size-4" />{text.manageService}
              </Button>
            </div>
          ) : null}

          {selectedProvider.credentialMode === 'api-key' ? <div className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="image-generation-api-key" className="text-xs font-medium text-fg-muted">
                {text.apiKey}
              </label>
              {apiKeyUrl ? (
                <a
                  href={apiKeyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                >
                  {text.getApiKey}
                  <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </a>
              ) : null}
            </div>
            <SecretInput
              key={selectedProvider.id}
              id="image-generation-api-key"
              value={apiKey}
              onChange={(next) => setApiKey(isMaskedSecret(apiKey) ? next.replace(/^•+/, '') : next)}
              placeholder={selectedProvider.configured ? text.existingKey : text.needsKey}
              labels={{ show: text.show, hide: text.hide, copy: text.copy, copied: text.copied }}
              reveal={() => revealProviderApiKey(selectedProvider.id).then((payload) => payload.apiKey)}
              loadFailedLabel={text.revealFailed}
              notInConfigFile={text.keyNotRevealable}
              className="mt-1.5"
              autoComplete="new-password"
            />
            <span className="mt-1.5 block font-normal leading-relaxed text-fg-subtle">
              {selectedProvider.configured ? text.savedKey : text.apiKeyHint}
            </span>
          </div> : null}

          <details className="mt-4 rounded-lg border border-edge bg-surface-subtle px-3 py-2.5">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-fg-muted">
              <SlidersHorizontal className="size-4" />{text.advanced}
            </summary>
            <label className="mt-3 block text-xs font-medium text-fg-muted">
              {text.baseUrl}
              <input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://…"
                className="mt-1.5 h-10 w-full rounded-lg border border-edge bg-surface-panel px-3 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </label>
          </details>

          {saved ? <p className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300" role="status">{text.enabled}</p> : null}
          {error ? <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p> : null}

          <div className="mt-4 flex justify-end">
            <Button variant="primary" disabled={!canSubmit || saving} onClick={() => void submit()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              <span className="grid">
                <span aria-hidden className="invisible col-start-1 row-start-1">{text.enable}</span>
                <span aria-hidden className="invisible col-start-1 row-start-1">{text.enabling}</span>
                <span className="col-start-1 row-start-1">{saving ? text.enabling : text.enable}</span>
              </span>
            </Button>
          </div>
        </section>
      ) : null}

      <CustomImageProviderDialog
        open={customDialogOpen}
        onOpenChange={setCustomDialogOpen}
        provider={editingCustomProvider}
        configured={Boolean(editingCustomProvider && providers.find((provider) => provider.id === editingCustomProvider.providerId)?.configured)}
        language={language}
        onSaved={refreshCustomProviders}
      />
    </div>
  );
}

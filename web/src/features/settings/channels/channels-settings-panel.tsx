import { ExternalLink, Settings2 } from 'lucide-react';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { SchemaForm, type JsonSchema } from '@/components/ui/schema-form';
import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

import { CHANNELS_HUB_PATH, channelDetailPath, normalizeChannelRouteId } from './channels-routes';
import { ChannelSetupCard } from './channel-setup-card';
import { ChannelsPageHeaderActions } from './channels-page-header-actions';
import { useChannelCatalog, type ChannelCatalogEntry } from './use-channel-catalog';

function configSwrKey(channelId: string | null): string | null {
  return channelId ? apiUrl(`/api/channels/${encodeURIComponent(channelId)}/config`) : null;
}

async function fetchChannelConfig(channelId: string): Promise<Record<string, unknown>> {
  const data = await fetchJson<{ ok?: boolean; payload?: { config?: Record<string, unknown> } }>(
    apiUrl(`/api/channels/${encodeURIComponent(channelId)}/config`),
  );
  return data.payload?.config ?? {};
}

function statusLabel(entry: ChannelCatalogEntry, ch: ReturnType<typeof messages>['channelsSettings']): string {
  if (entry.enabled && entry.runtime === 'loaded') return ch.hubStatusRunning;
  if (entry.enabled) return ch.hubStatusEnabled;
  if (entry.configured) return ch.hubStatusConfigured;
  return ch.hubStatusNotConfigured;
}

function getBasicConfigPaths(entry: ChannelCatalogEntry | undefined): string[] {
  if (!entry) return ['enabled'];
  const hints = entry.uiHints ?? {};
  const basic = Object.entries(hints)
    .filter(([, hint]) => {
      if (!isRecord(hint)) return false;
      if (hint.advanced === true) return false;
      const tags = Array.isArray(hint.tags) ? hint.tags.map(String) : [];
      return tags.includes('basic') || hint.advanced === false;
    })
    .map(([path]) => path);
  return basic.length > 0 ? basic : ['enabled'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneSchema(schema: JsonSchema | undefined): JsonSchema {
  return JSON.parse(JSON.stringify(schema ?? { type: 'object', properties: {} })) as JsonSchema;
}

function pickSchemaPaths(schema: JsonSchema, paths: string[]): JsonSchema {
  const out = { ...cloneSchema(schema), properties: {} as Record<string, unknown> };
  for (const path of paths) {
    const parts = path.split('.');
    let src: Record<string, unknown> = schema;
    let dst: Record<string, unknown> = out;
    for (const [index, part] of parts.entries()) {
      const srcProps = src.properties;
      if (!isRecord(srcProps) || !isRecord(srcProps[part])) break;
      const dstProps = isRecord(dst.properties) ? dst.properties : {};
      dst.properties = dstProps;
      if (!dstProps[part]) dstProps[part] = { ...cloneSchema(srcProps[part]), properties: {} };
      if (index === parts.length - 1) {
        dstProps[part] = cloneSchema(srcProps[part]);
        break;
      }
      src = srcProps[part];
      dst = dstProps[part];
    }
  }
  return out;
}

function removeEmptyObjectFields(schema: JsonSchema): boolean {
  const props = schema.properties;
  if (!isRecord(props)) return false;
  for (const [key, value] of Object.entries(props)) {
    if (!isRecord(value)) continue;
    if (value.type === 'object' && removeEmptyObjectFields(value)) {
      delete props[key];
    }
  }
  return Object.keys(props).length === 0;
}

function omitSchemaPaths(schema: JsonSchema, paths: string[]): JsonSchema {
  const out = cloneSchema(schema);
  for (const path of paths) {
    const parts = path.split('.');
    let cur: Record<string, unknown> = out;
    for (const [index, part] of parts.entries()) {
      const props = cur.properties;
      if (!isRecord(props)) break;
      if (index === parts.length - 1) {
        delete props[part];
        break;
      }
      if (!isRecord(props[part])) break;
      cur = props[part];
    }
  }
  removeEmptyObjectFields(out);
  return out;
}

function hasSchemaFields(schema: JsonSchema): boolean {
  return schema.type === 'object' && isRecord(schema.properties) && Object.keys(schema.properties).length > 0;
}

export function ChannelsSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const hasToken = useGatewayStore((s) => Boolean(s.token));
  const navigate = useNavigate();
  const { channelId: routeChannelId } = useParams<{ channelId?: string }>();
  const activeChannelId = normalizeChannelRouteId(routeChannelId);

  const catalog = useChannelCatalog(hasToken, language);
  const entries = catalog.entries;
  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);
  const activeEntry = useMemo(
    () => entries.find((entry) => entry.id === activeChannelId),
    [activeChannelId, entries],
  );

  const { data: remoteConfig, mutate: mutateConfig } = useSWR(
    hasToken && activeEntry ? configSwrKey(activeEntry.id) : null,
    () => fetchChannelConfig(activeEntry!.id),
  );
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveConfig = draft ?? remoteConfig ?? {};
  const ch = m.channelsSettings;
  const fullConfigSchema = useMemo(
    () => (activeEntry?.configSchema ?? { type: 'object', properties: {} }) as JsonSchema,
    [activeEntry?.configSchema],
  );
  const basicConfigPaths = useMemo(() => getBasicConfigPaths(activeEntry), [activeEntry]);
  const basicConfigSchema = useMemo(
    () => pickSchemaPaths(fullConfigSchema, basicConfigPaths),
    [basicConfigPaths, fullConfigSchema],
  );
  const advancedConfigSchema = useMemo(
    () => omitSchemaPaths(fullConfigSchema, basicConfigPaths),
    [basicConfigPaths, fullConfigSchema],
  );
  const schemaLabels = useMemo(() => ({
    defaultBooleanLabel: ch.schemaBooleanDefault,
    unsupportedArrayType: ch.schemaUnsupportedArrayType,
    arrayAddPlaceholder: ch.schemaArrayAddPlaceholder,
    unsupportedFieldType: (title: string, type?: string) => ch.schemaUnsupportedFieldType
      .replace('{{title}}', title)
      .replace('{{type}}', type ? ` (${type})` : ''),
  }), [ch]);

  const headerEnd = useMemo(
    () => hasToken ? (
      <ChannelsPageHeaderActions
        ch={ch}
        refreshing={catalog.isValidating}
        saveOk={false}
        onRefresh={() => void catalog.mutate()}
      />
    ) : null,
    [catalog, ch, hasToken],
  );

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: null,
      main: (
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight text-fg">{m.settingsSections.channels}</h1>
        </div>
      ),
      end: headerEnd,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, headerEnd, m.settingsSections.channels, setPageHeader]);

  const openChannel = useCallback((id: string) => {
    navigate(channelDetailPath(id));
    setDraft(null);
    setError(null);
  }, [navigate]);

  const closeChannel = useCallback(() => {
    navigate(CHANNELS_HUB_PATH);
    setDraft(null);
    setError(null);
  }, [navigate]);

  const saveConfig = useCallback(async () => {
    if (!activeEntry || !draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(apiUrl('/api/config'), {
        method: 'PATCH',
        body: JSON.stringify({ channels: { [activeEntry.id]: draft } }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? res.statusText);
      }
      await mutateConfig(draft, false);
      await catalog.mutate();
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [activeEntry, catalog, draft, mutateConfig]);

  const renderSetupCard = () => activeEntry ? (
    <ChannelSetupCard
      key={activeEntry.id}
      entry={activeEntry}
      locale={language}
      messages={ch}
      onChanged={async () => {
        await mutateConfig();
        await catalog.mutate();
      }}
    />
  ) : null;

  if (!hasToken) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
        <p className="text-sm text-fg-muted">{ch.tokenRequired}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-app-main gap-4 px-4 py-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <section className="min-w-0">
        {catalog.isLoading ? (
          <p className="text-sm text-fg-muted">{ch.loadingChannels}</p>
        ) : catalog.error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{String(catalog.error)}</p>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => openChannel(entry.id)}
                  className={cn(
                    'w-full rounded-lg border border-edge-subtle bg-surface-panel px-3 py-3 text-left transition-colors hover:border-edge',
                    activeEntry?.id === entry.id && 'border-accent/60 bg-accent-soft/40',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">{entry.label}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{entry.description ?? entry.id}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-xs text-fg-muted">
                      {statusLabel(entry, ch)}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="min-w-0 rounded-lg border border-edge-subtle bg-surface-base p-4">
        {!activeEntry ? (
          <p className="text-sm text-fg-muted">{ch.selectChannel}</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-fg">{activeEntry.label}</h2>
                <p className="mt-1 text-sm text-fg-muted">{activeEntry.description}</p>
                <p className="mt-1 text-xs text-fg-muted">
                  {activeEntry.extensionId} · {activeEntry.source}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {activeEntry.docsPath ? (
                  <Button type="button" variant="secondary" asChild>
                    <a href={activeEntry.docsPath} target="_blank" rel="noreferrer">
                      {ch.docs}
                      <ExternalLink className="ml-2 size-3.5" />
                    </a>
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" onClick={closeChannel}>{ch.close}</Button>
              </div>
            </div>

            {renderSetupCard()}

            <section className="rounded-lg border border-edge-subtle bg-surface-panel p-4">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-fg">{ch.basicConfiguration}</h3>
                <p className="mt-1 text-sm text-fg-muted">{ch.basicConfigurationHint}</p>
              </div>
              <SchemaForm
                schema={basicConfigSchema}
                values={effectiveConfig}
                onChange={(next) => setDraft(next)}
                disabled={saving}
                labels={schemaLabels}
              />
            </section>

            {hasSchemaFields(advancedConfigSchema) ? (
              <details className="group rounded-lg border border-edge-subtle bg-surface-panel">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-fg marker:hidden [&::-webkit-details-marker]:hidden">
                  <Settings2 className="size-4 text-fg-muted" />
                  {ch.advancedConfiguration}
                </summary>
                <div className="border-t border-edge-subtle p-4">
                  <SchemaForm
                    schema={advancedConfigSchema}
                    values={effectiveConfig}
                    onChange={(next) => setDraft(next)}
                    disabled={saving}
                    labels={schemaLabels}
                  />
                </div>
              </details>
            ) : null}

            {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={!draft || saving} onClick={() => setDraft(null)}>
                {ch.discard}
              </Button>
              <Button type="button" variant="primary" disabled={!draft || saving} onClick={() => void saveConfig()}>
                {saving ? ch.saving : ch.save}
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

import { Loader2, Plus, Plug, Trash2, Zap, Cable } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import {
  emptyMcpServerRow,
  fetchMcpServerTools,
  buildMcpServerConfigFromRow,
  normalizeMcpSettingsFromConfig,
  patchMcpSettings,
  testMcpServer,
  type McpServerRow,
  type McpSettingsState,
  type McpTransportKind,
} from '@/features/settings/mcp/mcp-config-api';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-sm font-medium text-fg">{label}</div>
      {children}
      {description ? <p className="text-xs leading-relaxed text-fg-subtle">{description}</p> : null}
    </div>
  );
}

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle',
    settingsInputFocusClass,
  );
}

const TRANSPORTS: McpTransportKind[] = ['stdio', 'sse', 'streamable-http'];

export function McpSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const t = m.mcpSettings;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [form, setForm] = useState<McpSettingsState | null>(null);
  const [baseline, setBaseline] = useState<McpSettingsState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const dirtyRef = useRef(false);

  const { data, error: swrError, isLoading, mutate } = useGatewayConfigSwr(hasToken);

  const parsed = useMemo(
    () =>
      data?.payload?.config !== undefined ? normalizeMcpSettingsFromConfig(data.payload.config) : null,
    [data],
  );

  useEffect(() => {
    if (!hasToken) {
      setForm(null);
      setBaseline(null);
      dirtyRef.current = false;
      return;
    }
    if (parsed === null) return;
    if (!dirtyRef.current) {
      setForm(parsed);
      setBaseline(parsed);
    }
  }, [hasToken, parsed]);

  const loading = Boolean(hasToken && isLoading && data === undefined && !swrError);
  const fetchError =
    swrError instanceof Error ? swrError.message : swrError ? String(swrError) : null;

  const dirty = useMemo(() => {
    if (!form || !baseline) return false;
    return JSON.stringify(form) !== JSON.stringify(baseline);
  }, [form, baseline]);

  const updateServer = useCallback((index: number, patch: Partial<McpServerRow>) => {
    dirtyRef.current = true;
    setForm((f) => {
      if (!f) return f;
      const servers = [...f.servers];
      servers[index] = { ...servers[index]!, ...patch };
      return { ...f, servers };
    });
  }, []);

  const addServer = useCallback(() => {
    dirtyRef.current = true;
    setForm((f) =>
      f ? { ...f, servers: [...f.servers, emptyMcpServerRow(`server-${f.servers.length + 1}`)] } : f,
    );
  }, []);

  const removeServer = useCallback((index: number) => {
    dirtyRef.current = true;
    setForm((f) => (f ? { ...f, servers: f.servers.filter((_, i) => i !== index) } : f));
  }, []);

  const save = useCallback(async () => {
    if (!form || saving) return;
    setSaving(true);
    setError(null);
    setSaveOk(false);
    try {
      await patchMcpSettings(form);
      const next = structuredClone(form);
      setBaseline(next);
      setForm(next);
      dirtyRef.current = false;
      setSaveOk(true);
      void mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [form, mutate, saving]);

  const runTest = useCallback(
    async (serverId: string, row?: McpServerRow) => {
      if (!serverId.trim()) return;
      setTestingId(serverId);
      setError(null);
      try {
        const serverConfig = row ? buildMcpServerConfigFromRow(row) : undefined;
        const result = await testMcpServer(serverId.trim(), serverConfig);
        const tools = await fetchMcpServerTools(serverId.trim()).catch(() =>
          result.tools.map((name) => ({ name })),
        );
        const preview = tools.slice(0, 8).map((tool) => tool.name).join(', ');
        const suffix = tools.length > 8 ? ` (+${tools.length - 8} more)` : '';
        setTestResults((prev) => ({
          ...prev,
          [serverId]: `${result.toolCount} tools: ${preview}${suffix}`,
        }));
      } catch (e) {
        setTestResults((prev) => ({
          ...prev,
          [serverId]: e instanceof Error ? e.message : String(e),
        }));
      } finally {
        setTestingId(null);
      }
    },
    [],
  );

  if (!hasToken) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-4 px-4 py-8">
        <h1 className="text-lg font-semibold text-fg">{t.title}</h1>
        <p className="text-sm text-fg-muted">{m.token.description}</p>
      </div>
    );
  }

  if (loading || !form) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-4 px-4 py-8">
        <h1 className="text-lg font-semibold text-fg">{t.title}</h1>
        <p className="text-sm text-fg-muted">{t.loading}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-fg">{t.title}</h1>
        <p className="mt-1 text-sm text-fg-muted">{t.subtitle}</p>
      </div>

      {(fetchError || error) && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
          {error ?? fetchError}
        </p>
      )}
      {saveOk && (
        <p className="rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg-muted">
          {t.saved}
        </p>
      )}

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Cable} title={t.globalTitle} subtitle={t.globalHint} />
        <Field label={t.idleTtlLabel} description={t.idleTtlHint}>
          <input
            type="number"
            min={0}
            className={inputClassName()}
            value={form.sessionIdleTtlMinutes ?? ''}
            placeholder={t.idleTtlPlaceholder}
            onChange={(e) => {
              dirtyRef.current = true;
              const raw = e.target.value.trim();
              setForm((f) =>
                f
                  ? {
                      ...f,
                      sessionIdleTtlMinutes: raw === '' ? undefined : Number.parseInt(raw, 10),
                    }
                  : f,
              );
            }}
          />
        </Field>
      </SettingsFormSection>

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Plug} title={t.serversTitle} subtitle={t.serversHint} />
        <div className="flex flex-col gap-4">
          {form.servers.length === 0 ? (
            <p className="text-sm text-fg-muted">{t.serversEmpty}</p>
          ) : null}
          {form.servers.map((row, index) => (
            <div
              key={`${row.id}-${index}`}
              className="rounded-xl border border-edge bg-surface-panel p-4"
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Plug className="size-4 text-accent" aria-hidden />
                <input
                  className={cn(inputClassName(), 'max-w-xs font-medium')}
                  value={row.id}
                  placeholder={t.serverIdPlaceholder}
                  onChange={(e) => updateServer(index, { id: e.target.value })}
                />
                <select
                  className={inputClassName()}
                  value={row.transport}
                  onChange={(e) =>
                    updateServer(index, { transport: e.target.value as McpTransportKind })
                  }
                >
                  {TRANSPORTS.map((kind) => (
                    <option key={kind} value={kind}>
                      {t.transportLabels[kind]}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!row.id.trim() || testingId === row.id}
                  onClick={() => void runTest(row.id, row)}
                >
                  {testingId === row.id ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Zap className="size-4" aria-hidden />
                  )}
                  {t.testConnection}
                </Button>
                <Button type="button" variant="ghost" onClick={() => removeServer(index)}>
                  <Trash2 className="size-4" aria-hidden />
                  {t.removeServer}
                </Button>
              </div>

              {row.transport === 'stdio' ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={t.commandLabel}>
                    <input
                      className={inputClassName()}
                      value={row.command}
                      onChange={(e) => updateServer(index, { command: e.target.value })}
                    />
                  </Field>
                  <Field label={t.argsLabel} description={t.argsHint}>
                    <input
                      className={inputClassName()}
                      value={row.argsText}
                      onChange={(e) => updateServer(index, { argsText: e.target.value })}
                    />
                  </Field>
                  <Field label={t.cwdLabel}>
                    <input
                      className={inputClassName()}
                      value={row.cwd}
                      onChange={(e) => updateServer(index, { cwd: e.target.value })}
                    />
                  </Field>
                  <Field label={t.envLabel} description={t.envHint}>
                    <textarea
                      className={cn(inputClassName(), 'min-h-[4rem] font-mono text-xs')}
                      value={row.envJson}
                      onChange={(e) => updateServer(index, { envJson: e.target.value })}
                    />
                  </Field>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={t.urlLabel}>
                    <input
                      className={inputClassName()}
                      value={row.url}
                      onChange={(e) => updateServer(index, { url: e.target.value })}
                    />
                  </Field>
                  <Field label={t.headersLabel} description={t.headersHint}>
                    <textarea
                      className={cn(inputClassName(), 'min-h-[4rem] font-mono text-xs')}
                      value={row.headersJson}
                      onChange={(e) => updateServer(index, { headersJson: e.target.value })}
                    />
                  </Field>
                </div>
              )}

              {testResults[row.id] ? (
                <p className="mt-3 text-xs text-fg-subtle">{testResults[row.id]}</p>
              ) : null}
            </div>
          ))}

          <Button type="button" variant="ghost" className="self-start" onClick={addServer}>
            <Plus className="size-4" aria-hidden />
            {t.addServer}
          </Button>
        </div>
      </SettingsFormSection>

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {saving ? t.saving : t.save}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={!dirty || saving}
          onClick={() => {
            if (!baseline) return;
            dirtyRef.current = false;
            setForm(structuredClone(baseline));
            setSaveOk(false);
            setError(null);
          }}
        >
          {t.discard}
        </Button>
      </div>

      <p className="text-xs text-fg-subtle">{t.disableHint}</p>
    </div>
  );
}

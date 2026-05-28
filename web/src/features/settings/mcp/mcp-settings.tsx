import { Cable, Loader2, Plus, Plug } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { SettingsFormSection, SettingsFormSectionHeader } from '@/features/settings/settings-form-section';
import {
  emptyMcpServerRow,
  buildMcpServerConfigFromRow,
  mcpServerCardKey,
  normalizeMcpSettingsFromConfig,
  patchMcpSettings,
  testMcpServer,
  type McpSettingsState,
  type McpToolInfo,
} from '@/features/settings/mcp/mcp-config-api';
import { McpServerCard } from '@/features/settings/mcp/mcp-server-card';
import { McpToolsListDialog } from '@/features/settings/mcp/mcp-tools-list-dialog';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle',
    settingsInputFocusClass,
  );
}

type ServerToolsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; tools: McpToolInfo[] }
  | { status: 'error'; message: string };

type McpFormDraft = {
  form: McpSettingsState | null;
  baseline: McpSettingsState | null;
  expandedKeys: Set<string>;
};

type McpFormAction =
  | { type: 'reset' }
  | { type: 'sync'; value: McpSettingsState }
  | { type: 'set-form'; updater: (prev: McpSettingsState) => McpSettingsState }
  | { type: 'saved'; value: McpSettingsState }
  | { type: 'toggle-expanded'; key: string }
  | { type: 'set-expanded'; keys: Set<string> };

function mcpFormReducer(state: McpFormDraft, action: McpFormAction): McpFormDraft {
  switch (action.type) {
    case 'reset':
      return { form: null, baseline: null, expandedKeys: new Set() };
    case 'sync':
      return { form: action.value, baseline: action.value, expandedKeys: new Set() };
    case 'set-form':
      return state.form ? { ...state, form: action.updater(state.form) } : state;
    case 'saved':
      return { form: action.value, baseline: action.value, expandedKeys: new Set() };
    case 'toggle-expanded': {
      const next = new Set(state.expandedKeys);
      if (next.has(action.key)) next.delete(action.key);
      else next.add(action.key);
      return { ...state, expandedKeys: next };
    }
    case 'set-expanded':
      return { ...state, expandedKeys: action.keys };
  }
}

export function McpSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const t = m.mcpSettings;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [formDraft, dispatchForm] = useReducer(mcpFormReducer, {
    form: null,
    baseline: null,
    expandedKeys: new Set<string>(),
  });
  const form = formDraft.form;
  const baseline = formDraft.baseline;
  const expandedKeys = formDraft.expandedKeys;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [serverTools, setServerTools] = useState<Record<string, ServerToolsState>>({});
  const [toolsDialog, setToolsDialog] = useState<{ serverId: string; tools: McpToolInfo[] } | null>(
    null,
  );
  const dirtyRef = useRef(false);

  const { data, error: swrError, isLoading, mutate } = useGatewayConfigSwr(hasToken);

  const parsed = useMemo(
    () =>
      data?.payload?.config !== undefined ? normalizeMcpSettingsFromConfig(data.payload.config) : null,
    [data],
  );

  useEffect(() => {
    if (!hasToken) {
      dispatchForm({ type: 'reset' });
      dirtyRef.current = false;
      return;
    }
    if (parsed === null || dirtyRef.current) return;
    dispatchForm({ type: 'sync', value: parsed });
  }, [hasToken, parsed]);

  const loading = Boolean(hasToken && isLoading && data === undefined && !swrError);
  const fetchError =
    swrError instanceof Error ? swrError.message : swrError ? String(swrError) : null;

  const dirty = useMemo(() => {
    if (!form || !baseline) return false;
    return JSON.stringify(form) !== JSON.stringify(baseline);
  }, [form, baseline]);

  const toggleExpanded = useCallback((key: string) => {
    dispatchForm({ type: 'toggle-expanded', key });
  }, []);

  const updateServer = useCallback((index: number, patch: Partial<McpSettingsState['servers'][number]>) => {
    dirtyRef.current = true;
    dispatchForm({
      type: 'set-form',
      updater: (f) => {
        const servers = [...f.servers];
        const prev = servers[index];
        if (!prev) return f;
        servers[index] = { ...prev, ...patch };
        if (patch.id && patch.id !== prev.id && prev.id) {
          setServerTools((st) => {
            const next = { ...st };
            delete next[prev.id];
            return next;
          });
        }
        return { ...f, servers };
      },
    });
  }, []);

  const addServer = useCallback(() => {
    dirtyRef.current = true;
    dispatchForm({
      type: 'set-form',
      updater: (f) => {
        const nextIndex = f.servers.length;
        const newRow = emptyMcpServerRow(`server-${nextIndex + 1}`);
        const key = mcpServerCardKey(newRow, nextIndex);
        dispatchForm({ type: 'set-expanded', keys: new Set(expandedKeys).add(key) });
        return { ...f, servers: [...f.servers, newRow] };
      },
    });
  }, [expandedKeys]);

  const removeServer = useCallback((index: number) => {
    dirtyRef.current = true;
    dispatchForm({
      type: 'set-form',
      updater: (f) => {
        const removed = f.servers[index];
        if (removed) {
          const key = mcpServerCardKey(removed, index);
          const nextExpanded = new Set(expandedKeys);
          nextExpanded.delete(key);
          dispatchForm({ type: 'set-expanded', keys: nextExpanded });
          if (removed.id) {
            setServerTools((st) => {
              const next = { ...st };
              delete next[removed.id];
              return next;
            });
          }
        }
        return { ...f, servers: f.servers.filter((_, i) => i !== index) };
      },
    });
  }, [expandedKeys]);

  const save = useCallback(async () => {
    if (!form || saving) return;
    setSaving(true);
    setError(null);
    setSaveOk(false);
    try {
      await patchMcpSettings(form);
      const next = structuredClone(form);
      dirtyRef.current = false;
      dispatchForm({ type: 'saved', value: next });
      setSaveOk(true);
      void mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [form, mutate, saving]);

  const runTest = useCallback(async (serverId: string, row?: McpSettingsState['servers'][number]) => {
    if (!serverId.trim()) return;
    setTestingId(serverId);
    setError(null);
    setServerTools((prev) => ({ ...prev, [serverId]: { status: 'loading' } }));
    try {
      const serverConfig = row ? buildMcpServerConfigFromRow(row) : undefined;
      const result = await testMcpServer(serverId.trim(), serverConfig);
      setServerTools((prev) => ({
        ...prev,
        [serverId]: {
          status: 'ok',
          tools: result.tools,
        },
      }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setServerTools((prev) => ({
        ...prev,
        [serverId]: { status: 'error', message },
      }));
    } finally {
      setTestingId(null);
    }
  }, []);

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
        <div className="flex flex-col gap-1.5">
          <div className="text-sm font-medium text-fg">{t.idleTtlLabel}</div>
          <input
            type="number"
            min={0}
            className={inputClassName()}
            value={form.sessionIdleTtlMinutes ?? ''}
            placeholder={t.idleTtlPlaceholder}
            onChange={(e) => {
              dirtyRef.current = true;
              const raw = e.target.value.trim();
              dispatchForm({
                type: 'set-form',
                updater: (f) => ({
                  ...f,
                  sessionIdleTtlMinutes: raw === '' ? undefined : Number.parseInt(raw, 10),
                }),
              });
            }}
          />
          <p className="text-xs leading-relaxed text-fg-subtle">{t.idleTtlHint}</p>
        </div>
      </SettingsFormSection>

      <SettingsFormSection>
        <SettingsFormSectionHeader icon={Plug} title={t.serversTitle} subtitle={t.serversHint} />
        <div className="flex flex-col gap-3">
          {form.servers.length === 0 ? (
            <p className="text-sm text-fg-muted">{t.serversEmpty}</p>
          ) : null}
          {form.servers.map((row, index) => {
            const cardKey = mcpServerCardKey(row, index);
            const toolState = serverTools[row.id] ?? { status: 'idle' as const };

            return (
              <McpServerCard
                key={cardKey}
                row={row}
                expanded={expandedKeys.has(cardKey)}
                onToggle={() => toggleExpanded(cardKey)}
                t={t}
                testing={testingId === row.id}
                toolState={toolState}
                onUpdate={(patch) => updateServer(index, patch)}
                onRemove={() => removeServer(index)}
                onTest={() => void runTest(row.id, row)}
                onViewTools={(tools) => setToolsDialog({ serverId: row.id, tools })}
              />
            );
          })}

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
            dispatchForm({ type: 'sync', value: structuredClone(baseline) });
            setSaveOk(false);
            setError(null);
            setServerTools({});
          }}
        >
          {t.discard}
        </Button>
      </div>

      <p className="text-xs text-fg-subtle">{t.disableHint}</p>

      {toolsDialog ? (
        <McpToolsListDialog
          open
          onOpenChange={(open) => {
            if (!open) setToolsDialog(null);
          }}
          serverId={toolsDialog.serverId}
          title={t.toolsDialogTitle}
          subtitle={t.toolsDialogSubtitle}
          searchPlaceholder={t.toolsDialogSearchPlaceholder}
          searchEmptyLabel={t.toolsDialogSearchEmpty}
          emptyLabel={t.toolsEmpty}
          closeLabel={t.toolsDialogClose}
          tools={toolsDialog.tools}
          stripPrefix={`${toolsDialog.serverId.trim()}__`}
        />
      ) : null}
    </div>
  );
}

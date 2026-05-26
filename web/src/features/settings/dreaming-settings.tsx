import { Activity, ScanLine, Settings2, Wrench, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import {
  dreamingSwrKey,
  fetchDreamingEvents,
  fetchDreamingPreview,
  fetchDreamingStatus,
  postDreamingAction,
  postDreamingRunNow,
  type DreamingEvent,
  type DreamingPhaseId,
  type DreamingPreviewItem,
} from '@/features/settings/dreaming-api';
import {
  normalizeDreamingFromConfig,
  patchDreamingConfig,
  type DreamingConfigState,
} from '@/features/settings/dreaming-config-api';
import { DreamingConfigSection } from '@/features/settings/dreaming-settings-config-section';
import { DreamingEventsSection } from '@/features/settings/dreaming-settings-events-section';
import { DreamingHeader } from '@/features/settings/dreaming-settings-header';
import { DreamingMaintenanceSection } from '@/features/settings/dreaming-settings-maintenance-section';
import { DreamingPreviewSection } from '@/features/settings/dreaming-settings-preview-section';
import { DreamingRuntimeSection } from '@/features/settings/dreaming-settings-runtime-section';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages, type MessageBundle } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

type DreamingSettingsI18n = MessageBundle['dreamingSettings'];
type DreamingSettingsTabId = 'config' | 'runtime' | 'insights' | 'maintenance';

const DREAMING_SETTINGS_TABS: readonly DreamingSettingsTabId[] = ['config', 'runtime', 'insights', 'maintenance'];

const DREAMING_SETTINGS_TAB_ICONS: Record<DreamingSettingsTabId, LucideIcon> = {
  config: Settings2,
  runtime: Activity,
  insights: ScanLine,
  maintenance: Wrench,
};

function parseDreamingSettingsTab(raw: string | null): DreamingSettingsTabId {
  if (raw && DREAMING_SETTINGS_TABS.includes(raw as DreamingSettingsTabId)) {
    return raw as DreamingSettingsTabId;
  }
  return 'config';
}

function dreamingSettingsTabLabel(t: DreamingSettingsI18n, tab: DreamingSettingsTabId): string {
  if (tab === 'config') return t.tabConfig;
  if (tab === 'runtime') return t.tabRuntime;
  if (tab === 'insights') return t.tabInsights;
  return t.tabMaintenance;
}

function dreamingSettingsTabHint(t: DreamingSettingsI18n, tab: DreamingSettingsTabId): string {
  if (tab === 'config') return t.configTabHint;
  if (tab === 'runtime') return t.runtimeTabHint;
  if (tab === 'insights') return t.insightsTabHint;
  return t.maintenanceTabHint;
}

export function DreamingSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const t = m.dreamingSettings;
  const schedulePickerLabels = m.cron.schedulePicker;
  const scheduleBadgeLabels = m.cron.scheduleBadge;
  const localeTag = language === 'zh' ? 'zh-CN' : 'en-US';

  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseDreamingSettingsTab(searchParams.get('tab'));
  const setActiveTab = useCallback(
    (tab: DreamingSettingsTabId) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (tab === 'config') next.delete('tab');
          else next.set('tab', tab);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const { data: cfgData } = useGatewayConfigSwr(hasToken);

  const [actionBusy, setActionBusy] = useState<null | 'reset_store' | 'clear_lock'>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [runOk, setRunOk] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runPhase, setRunPhase] = useState<DreamingPhaseId>('deep');
  const [cfgForm, setCfgForm] = useState<DreamingConfigState | null>(null);
  const [cfgBaseline, setCfgBaseline] = useState<DreamingConfigState | null>(null);
  const [cfgSaving, setCfgSaving] = useState(false);
  const [enableSaving, setEnableSaving] = useState(false);
  const [cfgOk, setCfgOk] = useState(false);
  const [cfgError, setCfgError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewItems, setPreviewItems] = useState<DreamingPreviewItem[] | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [events, setEvents] = useState<DreamingEvent[] | null>(null);

  const { data, error, isLoading, mutate } = useSWR(hasToken ? dreamingSwrKey() : null, fetchDreamingStatus, {
    revalidateOnFocus: false,
  });

  const errorMessages = useMemo(() => {
    const list: string[] = [];
    if (error) list.push(error instanceof Error ? error.message : String(error));
    if (actionError) list.push(actionError);
    if (runError) list.push(runError);
    if (previewError) list.push(previewError);
    if (eventsError) list.push(eventsError);
    if (cfgError) list.push(cfgError);
    return list;
  }, [error, actionError, runError, previewError, eventsError, cfgError]);

  const successMessages = useMemo(() => {
    const list: string[] = [];
    if (cfgOk) list.push(t.configSaved);
    if (runOk) list.push(t.runQueued);
    if (actionOk) list.push(t.actionOk);
    return list;
  }, [cfgOk, runOk, actionOk, t]);

  const doRefresh = useCallback(async () => {
    setActionOk(false);
    setActionError(null);
    setRunOk(false);
    setRunError(null);
    setCfgOk(false);
    setCfgError(null);
    setPreviewError(null);
    await mutate();
  }, [mutate]);

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await fetchDreamingPreview(20);
      setPreviewItems(res.items ?? []);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsError(null);
    try {
      const result = await fetchDreamingEvents(50);
      setEvents(result);
    } catch (e) {
      setEventsError(e instanceof Error ? e.message : String(e));
    } finally {
      setEventsLoading(false);
    }
  }, []);

  const doRunNow = useCallback(
    async (phase: DreamingPhaseId = 'deep') => {
      setRunBusy(true);
      setRunOk(false);
      setRunError(null);
      try {
        await postDreamingRunNow(phase);
        setRunOk(true);
        await mutate();
      } catch (e) {
        setRunError(e instanceof Error ? e.message : String(e));
      } finally {
        setRunBusy(false);
      }
    },
    [mutate],
  );

  const doAction = useCallback(
    async (action: 'reset_store' | 'clear_lock') => {
      setActionBusy(action);
      setActionError(null);
      setActionOk(false);
      try {
        await postDreamingAction(action);
        setActionOk(true);
        await mutate();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e));
      } finally {
        setActionBusy(null);
      }
    },
    [mutate],
  );

  const disabled = !hasToken || isLoading || Boolean(actionBusy);

  const cfgFromGateway = useMemo(() => {
    const rawCfg = cfgData?.payload?.config;
    return normalizeDreamingFromConfig(rawCfg ?? {});
  }, [cfgData]);

  useEffect(() => {
    if (!hasToken) return;
    if (!cfgBaseline) {
      setCfgBaseline(cfgFromGateway);
      setCfgForm(cfgFromGateway);
      return;
    }
    const nextJson = JSON.stringify(cfgFromGateway);
    const baseJson = JSON.stringify(cfgBaseline);
    if (nextJson !== baseJson) {
      setCfgBaseline(cfgFromGateway);
      setCfgForm(cfgFromGateway);
    }
  }, [cfgBaseline, cfgFromGateway, hasToken]);

  const cfgDirty = useMemo(() => {
    if (!cfgForm || !cfgBaseline) return false;
    return JSON.stringify(cfgForm) !== JSON.stringify(cfgBaseline);
  }, [cfgForm, cfgBaseline]);

  const saveConfig = useCallback(async () => {
    if (!cfgForm) return;
    setCfgSaving(true);
    setCfgOk(false);
    setCfgError(null);
    try {
      await patchDreamingConfig(cfgForm);
      setCfgBaseline(cfgForm);
      setCfgOk(true);
      await mutate();
    } catch (e) {
      setCfgError(e instanceof Error ? e.message : String(e));
    } finally {
      setCfgSaving(false);
    }
  }, [cfgForm, mutate]);

  const setDreamingEnabled = useCallback(
    async (enabled: boolean) => {
      if (!cfgForm || !hasToken) return;
      const next = { ...cfgForm, enabled };
      const prev = cfgForm;
      setCfgForm(next);
      setEnableSaving(true);
      setCfgOk(false);
      setCfgError(null);
      try {
        await patchDreamingConfig(next);
        setCfgBaseline(next);
        setCfgOk(true);
        await mutate();
      } catch (e) {
        setCfgForm(prev);
        setCfgError(e instanceof Error ? e.message : String(e));
      } finally {
        setEnableSaving(false);
      }
    },
    [cfgForm, hasToken, mutate],
  );

  const dreamingEnabled = cfgForm?.enabled ?? cfgFromGateway.enabled;

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-4 px-4 py-6">
      <DreamingHeader
        t={t}
        cfgForm={cfgForm}
        dreamingEnabled={dreamingEnabled}
        hasToken={hasToken}
        cfgSaving={cfgSaving}
        enableSaving={enableSaving}
        runPhase={runPhase}
        setRunPhase={setRunPhase}
        runBusy={runBusy}
        doRunNow={doRunNow}
        doRefresh={doRefresh}
        setDreamingEnabled={setDreamingEnabled}
      />

      {errorMessages.length > 0 ? (
        <div
          className="space-y-1.5 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3"
          role="alert"
        >
          {errorMessages.map((line) => (
            <p key={line} className="text-sm text-amber-800 dark:text-amber-200/90">
              {line}
            </p>
          ))}
        </div>
      ) : null}
      {successMessages.length > 0 ? (
        <div
          className="space-y-1.5 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3"
          role="status"
        >
          {successMessages.map((line) => (
            <p key={line} className="text-sm text-emerald-800 dark:text-emerald-200/90">
              {line}
            </p>
          ))}
        </div>
      ) : null}

      <DreamingSettingsTabs t={t} activeTab={activeTab} onChange={setActiveTab} />

      <DreamingTabPanel t={t} id="config" activeTab={activeTab}>
        <DreamingConfigSection
          t={t}
          schedulePickerLabels={schedulePickerLabels}
          hasToken={hasToken}
          cfgForm={cfgForm}
          cfgBaseline={cfgBaseline}
          cfgSaving={cfgSaving}
          cfgDirty={cfgDirty}
          setCfgForm={setCfgForm}
          setCfgOk={setCfgOk}
          setCfgError={setCfgError}
          saveConfig={saveConfig}
        />
      </DreamingTabPanel>

      <DreamingTabPanel t={t} id="runtime" activeTab={activeTab}>
        <DreamingRuntimeSection
          t={t}
          data={data}
          isLoading={isLoading}
          localeTag={localeTag}
          scheduleBadgeLabels={scheduleBadgeLabels}
        />
      </DreamingTabPanel>

      <DreamingTabPanel t={t} id="insights" activeTab={activeTab}>
        <div className="grid gap-4 xl:grid-cols-2">
          <DreamingPreviewSection
            t={t}
            hasToken={hasToken}
            previewLoading={previewLoading}
            previewItems={previewItems}
            loadPreview={loadPreview}
          />
          <DreamingEventsSection
            t={t}
            hasToken={hasToken}
            eventsLoading={eventsLoading}
            events={events}
            loadEvents={loadEvents}
          />
        </div>
      </DreamingTabPanel>

      <DreamingTabPanel t={t} id="maintenance" activeTab={activeTab}>
        <DreamingMaintenanceSection t={t} disabled={disabled} actionBusy={actionBusy} doAction={doAction} />
      </DreamingTabPanel>
    </div>
  );
}

function DreamingSettingsTabs({
  t,
  activeTab,
  onChange,
}: {
  t: DreamingSettingsI18n;
  activeTab: DreamingSettingsTabId;
  onChange: (tab: DreamingSettingsTabId) => void;
}) {
  return (
    <nav
      aria-label={t.tabsAriaLabel}
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
      role="tablist"
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const currentIndex = DREAMING_SETTINGS_TABS.indexOf(activeTab);
        const delta = event.key === 'ArrowRight' ? 1 : -1;
        const nextIndex = (currentIndex + delta + DREAMING_SETTINGS_TABS.length) % DREAMING_SETTINGS_TABS.length;
        onChange(DREAMING_SETTINGS_TABS[nextIndex]);
      }}
    >
      {DREAMING_SETTINGS_TABS.map((tab) => {
        const Icon = DREAMING_SETTINGS_TAB_ICONS[tab];
        const selected = tab === activeTab;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={selected}
            id={`dreaming-settings-tab-${tab}`}
            aria-controls={`dreaming-settings-panel-${tab}`}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              interaction.press,
              selected ? 'bg-accent-soft text-accent-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
            )}
            onClick={() => onChange(tab)}
          >
            <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            <span>{dreamingSettingsTabLabel(t, tab)}</span>
          </button>
        );
      })}
    </nav>
  );
}

function DreamingTabPanel({
  t,
  id,
  activeTab,
  children,
}: {
  t: DreamingSettingsI18n;
  id: DreamingSettingsTabId;
  activeTab: DreamingSettingsTabId;
  children: ReactNode;
}) {
  if (activeTab !== id) return null;

  return (
    <section
      id={`dreaming-settings-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`dreaming-settings-tab-${id}`}
      className="rounded-2xl border border-edge bg-surface-base px-4 py-5 sm:px-5"
    >
      <div className="mb-5">
        <div className="text-sm font-semibold text-fg">{dreamingSettingsTabLabel(t, id)}</div>
        <p className="mt-1 text-xs text-fg-subtle">{dreamingSettingsTabHint(t, id)}</p>
      </div>
      {children}
    </section>
  );
}

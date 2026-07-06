import { Activity, ScanLine, Settings2, Wrench, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';

import { uiPatchReducer } from '@/lib/settings-form-draft';
import { useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { PageTabs, type PageTabItem } from '@/components/ui/page-tabs';
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
import {
  SettingsPageFrame,
  SettingsTabPanel,
} from '@/features/settings/settings-page-layout';
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

type DreamingFormDraft = {
  form: DreamingConfigState | null;
  baseline: DreamingConfigState | null;
};

type DreamingFormAction =
  | { type: 'reset' }
  | { type: 'sync'; value: DreamingConfigState }
  | { type: 'set'; value: DreamingConfigState }
  | { type: 'saved'; value: DreamingConfigState };

function dreamingFormReducer(state: DreamingFormDraft, action: DreamingFormAction): DreamingFormDraft {
  switch (action.type) {
    case 'reset':
      return { form: null, baseline: null };
    case 'sync':
      return { form: action.value, baseline: action.value };
    case 'set':
      return { ...state, form: action.value };
    case 'saved':
      return { form: action.value, baseline: action.value };
  }
}

type DreamingUi = {
  actionBusy: null | 'reset_store' | 'clear_lock';
  actionError: string | null;
  actionOk: boolean;
  runBusy: boolean;
  runOk: boolean;
  runError: string | null;
  runPhase: DreamingPhaseId;
  cfgSaving: boolean;
  cfgOk: boolean;
  cfgError: string | null;
  previewLoading: boolean;
  previewError: string | null;
  previewItems: DreamingPreviewItem[] | null;
  eventsLoading: boolean;
  eventsError: string | null;
  events: DreamingEvent[] | null;
};

const initialDreamingUi: DreamingUi = {
  actionBusy: null,
  actionError: null,
  actionOk: false,
  runBusy: false,
  runOk: false,
  runError: null,
  runPhase: 'deep',
  cfgSaving: false,
  cfgOk: false,
  cfgError: null,
  previewLoading: false,
  previewError: null,
  previewItems: null,
  eventsLoading: false,
  eventsError: null,
  events: null,
};

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

  const [ui, dispatchUi] = useReducer(uiPatchReducer<DreamingUi>, initialDreamingUi);
  const {
    actionBusy,
    actionError,
    runBusy,
    runError,
    runPhase,
    cfgSaving,
    cfgError,
    previewLoading,
    previewError,
    previewItems,
    eventsLoading,
    eventsError,
    events,
  } = ui;
  const [cfgDraft, dispatchCfg] = useReducer(dreamingFormReducer, { form: null, baseline: null });
  const cfgForm = cfgDraft.form;
  const cfgBaseline = cfgDraft.baseline;
  const cfgDirtyRef = useRef(false);

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

  const doRefresh = useCallback(async () => {
    dispatchUi({
      type: 'patch',
      patch: {
        actionOk: false,
        actionError: null,
        runOk: false,
        runError: null,
        cfgOk: false,
        cfgError: null,
        previewError: null,
      },
    });
    await mutate();
  }, [mutate]);

  const loadPreview = useCallback(async () => {
    dispatchUi({ type: 'patch', patch: { previewLoading: true, previewError: null } });
    try {
      const res = await fetchDreamingPreview(20);
      dispatchUi({ type: 'patch', patch: { previewItems: res.items ?? [] } });
    } catch (e) {
      dispatchUi({
        type: 'patch',
        patch: { previewError: e instanceof Error ? e.message : String(e) },
      });
    } finally {
      dispatchUi({ type: 'patch', patch: { previewLoading: false } });
    }
  }, []);

  const loadEvents = useCallback(async () => {
    dispatchUi({ type: 'patch', patch: { eventsLoading: true, eventsError: null } });
    try {
      const result = await fetchDreamingEvents(50);
      dispatchUi({ type: 'patch', patch: { events: result } });
    } catch (e) {
      dispatchUi({
        type: 'patch',
        patch: { eventsError: e instanceof Error ? e.message : String(e) },
      });
    } finally {
      dispatchUi({ type: 'patch', patch: { eventsLoading: false } });
    }
  }, []);

  const doRunNow = useCallback(
    async (phase: DreamingPhaseId = 'deep') => {
      dispatchUi({ type: 'patch', patch: { runBusy: true, runOk: false, runError: null } });
      try {
        await postDreamingRunNow(phase);
        dispatchUi({ type: 'patch', patch: { runOk: true } });
        await mutate();
      } catch (e) {
        dispatchUi({
          type: 'patch',
          patch: { runError: e instanceof Error ? e.message : String(e) },
        });
      } finally {
        dispatchUi({ type: 'patch', patch: { runBusy: false } });
      }
    },
    [mutate],
  );

  const doAction = useCallback(
    async (action: 'reset_store' | 'clear_lock') => {
      dispatchUi({ type: 'patch', patch: { actionBusy: action, actionError: null, actionOk: false } });
      try {
        await postDreamingAction(action);
        dispatchUi({ type: 'patch', patch: { actionOk: true } });
        await mutate();
      } catch (e) {
        dispatchUi({
          type: 'patch',
          patch: { actionError: e instanceof Error ? e.message : String(e) },
        });
      } finally {
        dispatchUi({ type: 'patch', patch: { actionBusy: null } });
      }
    },
    [mutate],
  );

  const disabled = !hasToken || isLoading || Boolean(actionBusy);

  const cfgFromGateway = useMemo(() => {
    const rawCfg = data?.config;
    return normalizeDreamingFromConfig(rawCfg ?? {});
  }, [data]);
  const cfgAgentId = data?.agentId ?? 'main';
  const cfgBaseMemory = data?.memory;

  useEffect(() => {
    if (!hasToken) {
      dispatchCfg({ type: 'reset' });
      cfgDirtyRef.current = false;
      return;
    }
    if (!cfgDirtyRef.current) {
      dispatchCfg({ type: 'sync', value: cfgFromGateway });
    }
  }, [cfgFromGateway, hasToken]);

  const cfgDirty = useMemo(() => {
    if (!cfgForm || !cfgBaseline) return false;
    return JSON.stringify(cfgForm) !== JSON.stringify(cfgBaseline);
  }, [cfgForm, cfgBaseline]);

  const saveConfig = useCallback(async () => {
    if (!cfgForm) return;
    dispatchUi({ type: 'patch', patch: { cfgSaving: true, cfgOk: false, cfgError: null } });
    try {
      await patchDreamingConfig(cfgAgentId, cfgForm, cfgBaseMemory);
      dispatchCfg({ type: 'saved', value: cfgForm });
      cfgDirtyRef.current = false;
      dispatchUi({ type: 'patch', patch: { cfgOk: true } });
      await mutate();
    } catch (e) {
      dispatchUi({
        type: 'patch',
        patch: { cfgError: e instanceof Error ? e.message : String(e) },
      });
    } finally {
      dispatchUi({ type: 'patch', patch: { cfgSaving: false } });
    }
  }, [cfgAgentId, cfgBaseMemory, cfgForm, mutate]);

  return (
    <SettingsPageFrame>
      <DreamingHeader
        t={t}
        hasToken={hasToken}
        cfgForm={cfgForm}
        cfgSaving={cfgSaving}
        cfgDirty={cfgDirty}
        saveConfig={saveConfig}
        doRefresh={doRefresh}
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
      <DreamingSettingsTabNav t={t} activeTab={activeTab} onChange={setActiveTab} />

      <DreamingTabPanel t={t} id="config" activeTab={activeTab}>
        <DreamingConfigSection
          t={t}
          schedulePickerLabels={schedulePickerLabels}
          hasToken={hasToken}
          cfgForm={cfgForm}
          cfgBaseline={cfgBaseline}
          cfgDirty={cfgDirty}
          cfgSaving={cfgSaving}
          runPhase={runPhase}
          setRunPhase={(phase) => dispatchUi({ type: 'patch', patch: { runPhase: phase } })}
          runBusy={runBusy}
          setCfgForm={(next) => {
            cfgDirtyRef.current = true;
            const resolved =
              typeof next === 'function' ? next(cfgForm) : next;
            if (resolved) {
              dispatchCfg({ type: 'set', value: resolved });
            }
          }}
          doRunNow={doRunNow}
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
    </SettingsPageFrame>
  );
}

function DreamingSettingsTabNav({
  t,
  activeTab,
  onChange,
}: {
  t: DreamingSettingsI18n;
  activeTab: DreamingSettingsTabId;
  onChange: (tab: DreamingSettingsTabId) => void;
}) {
  const items: PageTabItem<DreamingSettingsTabId>[] = DREAMING_SETTINGS_TABS.map((tab) => ({
    id: tab,
    label: dreamingSettingsTabLabel(t, tab),
    icon: DREAMING_SETTINGS_TAB_ICONS[tab],
  }));
  return (
    <PageTabs
      items={items}
      activeTab={activeTab}
      onChange={onChange}
      ariaLabel={t.tabsAriaLabel}
      tabIdPrefix="dreaming-settings-tab"
      panelIdPrefix="dreaming-settings-panel"
    />
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
  const showHeading = id !== 'config';

  return (
    <SettingsTabPanel
      id={id}
      activeTab={activeTab}
      tabIdPrefix="dreaming-settings-tab"
      panelIdPrefix="dreaming-settings-panel"
      title={dreamingSettingsTabLabel(t, id)}
      hint={dreamingSettingsTabHint(t, id)}
      showHeading={showHeading}
    >
      {children}
    </SettingsTabPanel>
  );
}

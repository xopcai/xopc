import { Clock, FileText, Heart, Loader2, MessageSquare, Play, RefreshCw, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';

import { uiPatchReducer } from '@/lib/settings-form-draft';
import { useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { AutosaveStatus } from '@/components/ui/autosave-status';
import { PageTabs, type PageTabItem } from '@/components/ui/page-tabs';
import { getSessionChatIds, type ChannelStatus, type SessionChatId } from '@/features/settings/channel-recipient-api';
import { formatRecipientOptionLabel } from '@/features/settings/channel-recipient-api';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { channelsStatusSwrKey, fetchChannelsStatusSwr } from '@/features/settings/channels-status-swr';
import {
  normalizeHeartbeatFromConfig,
  patchHeartbeatSettings,
  putHeartbeatMd,
  triggerHeartbeat,
} from '@/features/settings/heartbeat-config-api';
import { fetchHeartbeatMdSwr, heartbeatMdSwrKey } from '@/features/settings/heartbeat-md-swr';
import type { HeartbeatSettingsState } from '@/features/settings/heartbeat-settings.types';
import {
  SettingsPageFrame,
  SettingsPageHeader,
  SettingsTabPanel,
} from '@/features/settings/settings-page-layout';
import { SettingsPageSkeleton } from '@/features/settings/settings-loading-skeleton';
import { selectFieldMaxWidthClass, selectTriggerClass, settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { messages, type HeartbeatSettingsMessages } from '@/i18n/messages';
import { ScheduleField } from '@/features/scheduling/schedule-field';
import { docsGuidePageUrl } from '@/navigation';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { useAsyncResource } from '@/lib/use-async-resource';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { useAutosave } from '@/lib/use-autosave';

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle',
    settingsInputFocusClass,
    'dark:border-edge',
  );
}

function selectClassName(): string {
  return cn(selectTriggerClass, selectFieldMaxWidthClass);
}

type CronMessages = ReturnType<typeof messages>['cron'];
type HeartbeatSettingsTabId = 'schedule' | 'delivery' | 'prompt' | 'document';

const HEARTBEAT_SETTINGS_TABS: readonly HeartbeatSettingsTabId[] = [
  'schedule',
  'delivery',
  'prompt',
  'document',
];

const HEARTBEAT_SETTINGS_TAB_ICONS: Record<HeartbeatSettingsTabId, LucideIcon> = {
  schedule: Clock,
  delivery: MessageSquare,
  prompt: Heart,
  document: FileText,
};

function parseHeartbeatSettingsTab(raw: string | null): HeartbeatSettingsTabId {
  if (raw && HEARTBEAT_SETTINGS_TABS.includes(raw as HeartbeatSettingsTabId)) {
    return raw as HeartbeatSettingsTabId;
  }
  return 'schedule';
}

function heartbeatSettingsTabLabel(h: HeartbeatSettingsMessages, tab: HeartbeatSettingsTabId): string {
  if (tab === 'schedule') return h.tabSchedule;
  if (tab === 'delivery') return h.tabDelivery;
  if (tab === 'prompt') return h.tabPrompt;
  return h.tabDocument;
}

function heartbeatSettingsTabHint(h: HeartbeatSettingsMessages, tab: HeartbeatSettingsTabId): string {
  if (tab === 'schedule') return h.scheduleTabHint;
  if (tab === 'delivery') return h.deliveryTabHint;
  if (tab === 'prompt') return h.promptTabHint;
  return h.documentTabHint;
}

type HeartbeatFormDraft = {
  form: HeartbeatSettingsState | null;
  baseline: HeartbeatSettingsState | null;
};

type HeartbeatFormAction =
  | { type: 'reset' }
  | { type: 'sync'; value: HeartbeatSettingsState }
  | { type: 'patch'; patch: Partial<HeartbeatSettingsState> }
  | { type: 'saved'; value: HeartbeatSettingsState };

function heartbeatFormReducer(state: HeartbeatFormDraft, action: HeartbeatFormAction): HeartbeatFormDraft {
  switch (action.type) {
    case 'reset':
      return { form: null, baseline: null };
    case 'sync': {
      const snapshot = structuredClone(action.value);
      return { form: snapshot, baseline: structuredClone(snapshot) };
    }
    case 'patch':
      return { ...state, form: state.form ? { ...state.form, ...action.patch } : null };
    case 'saved': {
      const snapshot = structuredClone(action.value);
      const form = state.form && JSON.stringify(state.form) !== JSON.stringify(action.value)
        ? state.form
        : snapshot;
      return { form, baseline: structuredClone(snapshot) };
    }
  }
}

type HeartbeatDocDraft = { doc: string; baseline: string };

type HeartbeatDocAction =
  | { type: 'reset' }
  | { type: 'sync'; value: string }
  | { type: 'set'; value: string }
  | { type: 'saved'; value: string };

function heartbeatDocReducer(state: HeartbeatDocDraft, action: HeartbeatDocAction): HeartbeatDocDraft {
  switch (action.type) {
    case 'reset':
      return { doc: '', baseline: '' };
    case 'sync':
      return { doc: action.value, baseline: action.value };
    case 'set':
      return { ...state, doc: action.value };
    case 'saved':
      return { doc: state.doc === action.value ? action.value : state.doc, baseline: action.value };
  }
}

function workspacePathFromConfig(cfg: unknown): string {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return '';
  const agents = (cfg as { agents?: unknown }).agents;
  if (!agents || typeof agents !== 'object' || Array.isArray(agents)) return '';
  const agentRecord = agents as { default?: unknown; list?: unknown };
  if (!Array.isArray(agentRecord.list)) return '';
  const defaultId = typeof agentRecord.default === 'string' ? agentRecord.default : '';
  const selected =
    agentRecord.list.find((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
      return defaultId ? (entry as { id?: unknown }).id === defaultId : true;
    }) ?? agentRecord.list[0];
  if (!selected || typeof selected !== 'object' || Array.isArray(selected)) return '';
  const workspace = (selected as { workspace?: unknown }).workspace;
  if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) return '';
  const root = (workspace as { root?: unknown }).root;
  return typeof root === 'string' ? root : '';
}

type HeartbeatUi = {
  triggerLoading: boolean;
  triggerOk: boolean;
  triggerError: string | null;
};

const initialHeartbeatUi: HeartbeatUi = {
  triggerLoading: false,
  triggerOk: false,
  triggerError: null,
};

export function HeartbeatSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const h = m.heartbeatSettings;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseHeartbeatSettingsTab(searchParams.get('tab'));
  const setActiveTab = useCallback(
    (tab: HeartbeatSettingsTabId) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (tab === 'schedule') next.delete('tab');
          else next.set('tab', tab);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const [formDraft, dispatchForm] = useReducer(heartbeatFormReducer, { form: null, baseline: null });
  const form = formDraft.form;
  const baseline = formDraft.baseline;
  const [docDraft, dispatchDoc] = useReducer(heartbeatDocReducer, { doc: '', baseline: '' });
  const doc = docDraft.doc;
  const docBaseline = docDraft.baseline;
  const [ui, dispatchUi] = useReducer(uiPatchReducer<HeartbeatUi>, initialHeartbeatUi);
  const { triggerLoading, triggerOk, triggerError } = ui;
  const configDirtyRef = useRef(false);
  const docDirtyRef = useRef(false);
  const formRef = useRef(form);
  const docRef = useRef(doc);
  formRef.current = form;
  docRef.current = doc;

  const {
    data: cfgData,
    error: cfgErr,
    isLoading: cfgLoading,
    mutate: mutCfg,
  } = useGatewayConfigSwr(hasToken);
  const {
    data: mdContent,
    error: mdErr,
    isLoading: mdLoading,
    mutate: mutMd,
  } = useSWR(hasToken ? heartbeatMdSwrKey() : null, fetchHeartbeatMdSwr, { revalidateOnFocus: false });
  const { data: channels = [] } = useSWR(hasToken ? channelsStatusSwrKey() : null, fetchChannelsStatusSwr, {
    revalidateOnFocus: false,
  });

  const workspacePath = useMemo(
    () => workspacePathFromConfig(cfgData?.payload?.config),
    [cfgData],
  );

  const heartbeatParsed = useMemo(
    () => normalizeHeartbeatFromConfig(cfgData?.payload?.config ?? {}),
    [cfgData],
  );

  const dirtyConfig = useMemo(() => {
    if (!form || !baseline) return false;
    return JSON.stringify(form) !== JSON.stringify(baseline);
  }, [form, baseline]);

  const dirtyDoc = doc !== docBaseline;

  useEffect(() => {
    if (!hasToken) {
      dispatchForm({ type: 'reset' });
      configDirtyRef.current = false;
      return;
    }
    if (cfgData === undefined) return;
    if (!configDirtyRef.current) {
      dispatchForm({ type: 'sync', value: heartbeatParsed });
    }
  }, [hasToken, cfgData, heartbeatParsed]);

  useEffect(() => {
    if (!hasToken) {
      dispatchDoc({ type: 'reset' });
      docDirtyRef.current = false;
      return;
    }
    if (mdContent === undefined) return;
    if (!docDirtyRef.current) {
      dispatchDoc({ type: 'sync', value: mdContent });
    }
  }, [hasToken, mdContent]);

  const fetchError =
    cfgErr instanceof Error
      ? cfgErr.message
      : cfgErr
        ? String(cfgErr)
        : mdErr instanceof Error
          ? mdErr.message
          : mdErr
            ? String(mdErr)
            : null;

  const loading = Boolean(
    hasToken &&
      (cfgData === undefined || mdContent === undefined) &&
      !fetchError &&
      (cfgLoading || mdLoading),
  );

  const deliveryTarget = form?.target.trim() ?? '';
  const { data: sessionChatIds, setData: setSessionChatIds } = useAsyncResource(
    () => getSessionChatIds(deliveryTarget),
    [hasToken, deliveryTarget],
    { enabled: hasToken && deliveryTarget.length > 0, initial: [] as SessionChatId[], errorData: [] },
  );

  const refreshSessionChatIds = useCallback(() => {
    if (!deliveryTarget) return;
    void getSessionChatIds(deliveryTarget).then(setSessionChatIds);
  }, [deliveryTarget, setSessionChatIds]);

  const runHeartbeatNow = useCallback(async () => {
    dispatchUi({ type: 'patch', patch: { triggerLoading: true, triggerOk: false, triggerError: null } });
    try {
      await triggerHeartbeat();
      dispatchUi({ type: 'patch', patch: { triggerOk: true } });
      window.setTimeout(() => dispatchUi({ type: 'patch', patch: { triggerOk: false } }), 3000);
    } catch (e) {
      dispatchUi({
        type: 'patch',
        patch: { triggerError: e instanceof Error ? e.message : h.triggerError },
      });
    } finally {
      dispatchUi({ type: 'patch', patch: { triggerLoading: false } });
    }
  }, [h.triggerError]);

  const update = useCallback((patch: Partial<HeartbeatSettingsState>) => {
    configDirtyRef.current = true;
    dispatchForm({ type: 'patch', patch });
  }, []);

  const dirty = dirtyConfig || dirtyDoc;

  const autosaveValue = useMemo(() => form ? ({ form, doc, saveConfig: dirtyConfig, saveDoc: dirtyDoc }) : null, [dirtyConfig, dirtyDoc, doc, form]);

  const save = useCallback(async (snapshot: NonNullable<typeof autosaveValue>) => {
    try {
      if (snapshot.saveConfig) {
        await patchHeartbeatSettings(snapshot.form);
        dispatchForm({ type: 'saved', value: snapshot.form });
        configDirtyRef.current = Boolean(formRef.current && JSON.stringify(formRef.current) !== JSON.stringify(snapshot.form));
      }
      if (snapshot.saveDoc) {
        await putHeartbeatMd(snapshot.doc);
        dispatchDoc({ type: 'saved', value: snapshot.doc });
        docDirtyRef.current = docRef.current !== snapshot.doc;
      }
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : snapshot.saveConfig ? h.saveConfigError : h.saveDocError);
    }
  }, [h.saveConfigError, h.saveDocError]);

  const autosave = useAutosave({ value: autosaveValue, dirty, onSave: save, delayMs: dirtyDoc ? 900 : 500 });

  if (!hasToken) {
    return (
      <SettingsPageFrame gap="gap-3" padding="px-3 py-8 sm:px-5 xl:px-6">
        <SettingsPageHeader title={m.settingsSections.heartbeat} />
        <p className="text-sm text-fg-muted">{h.needToken}</p>
      </SettingsPageFrame>
    );
  }

  if (loading) {
    return (
      <SettingsPageFrame gap="gap-6" padding="px-3 py-8 sm:px-5 xl:px-6">
        <SettingsPageSkeleton sections={3} />
      </SettingsPageFrame>
    );
  }

  if (!form) {
    return (
      <SettingsPageFrame gap="gap-3" padding="px-3 py-8 sm:px-5 xl:px-6">
        <p className="text-sm text-fg-muted">{fetchError ?? h.loadError}</p>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void mutCfg();
            void mutMd();
          }}
        >
          {h.retry}
        </Button>
      </SettingsPageFrame>
    );
  }

  return (
    <SettingsPageFrame
      aria-busy={autosave.status === 'saving'}
      data-has-baseline={baseline ? '1' : '0'}
      onBlurCapture={autosave.onBlurCapture}
    >
      <SettingsPageHeader
        title={m.settingsSections.heartbeat}
        subtitle={h.subtitle}
        docsLink={docsGuidePageUrl(language, 'heartbeat')}
        docsLabel={h.docsLink}
        actions={
          <>
          <AutosaveStatus status={autosave.status} error={autosave.error} />
          <Button
            type="button"
            variant="secondary"
            className="inline-flex items-center gap-2"
            disabled={triggerLoading}
            onClick={() => void runHeartbeatNow()}
          >
            {triggerLoading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Play className="size-4" strokeWidth={1.75} aria-hidden />
            )}
            {triggerLoading ? h.triggering : h.triggerNow}
          </Button>
          {triggerOk ? <span className="text-sm text-fg-muted">{h.triggered}</span> : null}
          </>
        }
      />

      {workspacePath ? (
        <p className="text-xs text-fg-subtle">
          {h.workspaceLabel}: <span className="font-mono text-fg-muted">{workspacePath}</span>
        </p>
      ) : null}

      {autosave.error ? <p className="text-sm text-red-600 dark:text-red-400">{autosave.error}</p> : null}
      {triggerError ? <p className="text-sm text-red-600 dark:text-red-400">{triggerError}</p> : null}

      <HeartbeatSettingsTabNav h={h} activeTab={activeTab} onChange={setActiveTab} />

      <HeartbeatTabPanel h={h} id="schedule" activeTab={activeTab}>
        <HeartbeatScheduleFields h={h} form={form} update={update} />
      </HeartbeatTabPanel>

      <HeartbeatTabPanel h={h} id="delivery" activeTab={activeTab}>
        <HeartbeatDeliveryFields
          h={h}
          cron={m.cron}
          form={form}
          channels={channels}
          sessionChatIds={sessionChatIds}
          onRefreshChatIds={refreshSessionChatIds}
          update={update}
          inputClassName={inputClassName}
          selectClassName={selectClassName}
        />
      </HeartbeatTabPanel>

      <HeartbeatTabPanel h={h} id="prompt" activeTab={activeTab}>
        <HeartbeatPromptFields h={h} form={form} update={update} inputClassName={inputClassName} />
      </HeartbeatTabPanel>

      <HeartbeatTabPanel h={h} id="document" activeTab={activeTab}>
        <p className="mb-3 text-xs text-fg-subtle">{h.docHint}</p>
        <textarea
          className={cn(inputClassName(), 'min-h-72 resize-y font-mono text-xs leading-relaxed')}
          value={doc}
          onChange={(e) => {
            docDirtyRef.current = true;
            dispatchDoc({ type: 'set', value: e.target.value });
          }}
          spellCheck={false}
          aria-label={h.docSection}
          data-doc-in-sync={doc === docBaseline ? 'true' : 'false'}
        />
      </HeartbeatTabPanel>
    </SettingsPageFrame>
  );
}

function HeartbeatSettingsTabNav({
  h,
  activeTab,
  onChange,
}: {
  h: HeartbeatSettingsMessages;
  activeTab: HeartbeatSettingsTabId;
  onChange: (tab: HeartbeatSettingsTabId) => void;
}) {
  const items: PageTabItem<HeartbeatSettingsTabId>[] = HEARTBEAT_SETTINGS_TABS.map((tab) => ({
    id: tab,
    label: heartbeatSettingsTabLabel(h, tab),
    icon: HEARTBEAT_SETTINGS_TAB_ICONS[tab],
  }));
  return (
    <PageTabs
      items={items}
      activeTab={activeTab}
      onChange={onChange}
      ariaLabel={h.tabsAriaLabel}
      tabIdPrefix="heartbeat-settings-tab"
      panelIdPrefix="heartbeat-settings-panel"
    />
  );
}

function HeartbeatTabPanel({
  h,
  id,
  activeTab,
  children,
}: {
  h: HeartbeatSettingsMessages;
  id: HeartbeatSettingsTabId;
  activeTab: HeartbeatSettingsTabId;
  children: ReactNode;
}) {
  return (
    <SettingsTabPanel
      id={id}
      activeTab={activeTab}
      tabIdPrefix="heartbeat-settings-tab"
      panelIdPrefix="heartbeat-settings-panel"
      title={heartbeatSettingsTabLabel(h, id)}
      hint={heartbeatSettingsTabHint(h, id)}
    >
      <div className="space-y-4">{children}</div>
    </SettingsTabPanel>
  );
}

function HeartbeatScheduleFields({
  h,
  form,
  update,
}: {
  h: HeartbeatSettingsMessages;
  form: HeartbeatSettingsState;
  update: (patch: Partial<HeartbeatSettingsState>) => void;
}) {
  return (
    <>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="ui-checkbox"
          checked={form.enabled}
          onChange={(event) => update({ enabled: event.target.checked })}
        />
        {h.enable}
      </label>

      <ScheduleField
        kind="interval"
        label={h.interval}
        valueMs={form.intervalMs}
        onChangeMs={(intervalMs) => update({ intervalMs })}
        labels={{ secondsLabel: h.intervalSecondsLabel, presets: h.intervalPresets }}
        hint={`${h.intervalHintPreset} ${h.intervalHint}`}
      />

      <ScheduleField
        kind="active-hours"
        label={h.activeHoursTitle}
        value={form.activeHours}
        onChange={(activeHours) => update({ activeHours })}
        labels={{
          start: h.activeStart,
          end: h.activeEnd,
          timezone: h.activeTimezone,
          add: h.addActiveHours,
          clear: h.clearActiveHours,
        }}
        hint={h.activeHoursHint}
      />
    </>
  );
}

function HeartbeatDeliveryFields({
  h,
  cron: c,
  form,
  channels,
  sessionChatIds,
  onRefreshChatIds,
  update,
  inputClassName: inputCn,
  selectClassName: selectCn,
}: {
  h: HeartbeatSettingsMessages;
  cron: CronMessages;
  form: HeartbeatSettingsState;
  channels: ChannelStatus[];
  sessionChatIds: SessionChatId[];
  onRefreshChatIds: () => void;
  update: (patch: Partial<HeartbeatSettingsState>) => void;
  inputClassName: typeof inputClassName;
  selectClassName: typeof selectClassName;
}) {
  const channelNames = useMemo(() => new Set(channels.map((channel) => channel.name)), [channels]);
  const targetTrim = form.target.trim();
  const showCustomChannel = Boolean(targetTrim && !channelNames.has(targetTrim));

  return (
    <>
      <p className="text-xs text-fg-subtle">{h.deliveryHint}</p>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg-muted">{c.channel}</span>
        <Select
          className={selectCn()}
          value={targetTrim}
          onChange={(event) => {
            const value = event.target.value.trim();
            update({ target: value, targetChatId: '' });
          }}
        >
          <SelectOption value="">{h.channelNone}</SelectOption>
          {showCustomChannel ? (
            <SelectOption value={targetTrim}>
              {targetTrim} ({h.customChannelSuffix})
            </SelectOption>
          ) : null}
          {channels.map((channel) => (
            <SelectOption key={channel.name} value={channel.name} disabled={!channel.enabled}>
              {channel.name} {!channel.enabled ? '(disabled)' : ''}
            </SelectOption>
          ))}
        </Select>
      </label>

      {targetTrim ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-fg-muted">{c.recipient}</span>
            <Button
              type="button"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs"
              title={c.refreshRecipientHint}
              onClick={onRefreshChatIds}
            >
              <RefreshCw className="size-3.5" strokeWidth={1.75} aria-hidden />
              {c.refreshList}
            </Button>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              className={cn(inputCn(), 'min-w-0 flex-1')}
              value={form.targetChatId}
              onChange={(event) => update({ targetChatId: event.target.value })}
              placeholder={c.recipientPlaceholder}
              autoComplete="off"
            />
            <Select
              className={cn(selectCn(), 'max-w-40 shrink-0 text-xs')}
              value={form.targetChatId}
              onChange={(event) => {
                const value = event.target.value;
                if (value) update({ targetChatId: value });
              }}
            >
              <SelectOption value="">{c.selectRecipient}</SelectOption>
              {sessionChatIds.length > 0 ? (
                sessionChatIds.map((item) => (
                  <SelectOption key={`${item.channel}-${item.chatId}`} value={item.chatId}>
                    {formatRecipientOptionLabel(item, c.lastActiveLabels)}
                  </SelectOption>
                ))
              ) : (
                <SelectOption value="" disabled>
                  {c.noRecentChatsOption}
                </SelectOption>
              )}
            </Select>
          </div>
          <p className="text-xs text-fg-muted">
            {sessionChatIds.length > 0 ? c.enterManuallyOrSelect : c.noRecentChats}
          </p>
        </div>
      ) : null}
    </>
  );
}

function HeartbeatPromptFields({
  h,
  form,
  update,
  inputClassName: inputCn,
}: {
  h: HeartbeatSettingsMessages;
  form: HeartbeatSettingsState;
  update: (patch: Partial<HeartbeatSettingsState>) => void;
  inputClassName: typeof inputClassName;
}) {
  return (
    <>
      <label className="flex cursor-pointer items-start gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="ui-checkbox mt-0.5"
          checked={form.includeSystemPromptSection}
          onChange={(event) => update({ includeSystemPromptSection: event.target.checked })}
        />
        <span>
          {h.includeSystemPromptSection}
          <span className="mt-1 block text-xs text-fg-subtle">{h.includeSystemPromptSectionHint}</span>
        </span>
      </label>

      <div>
        <div className="mb-1 text-sm font-medium text-fg">{h.prompt}</div>
        <textarea
          className={cn(inputCn(), 'min-h-36 resize-y font-mono text-xs')}
          value={form.prompt}
          onChange={(event) => update({ prompt: event.target.value })}
          placeholder={h.promptPlaceholder}
        />
        <p className="mt-1 text-xs text-fg-subtle">{h.promptHint}</p>
      </div>

      <div>
        <div className="mb-1 text-sm font-medium text-fg">{h.ackMaxChars}</div>
        <input
          type="number"
          min={1}
          className={inputCn()}
          value={form.ackMaxChars === '' ? '' : form.ackMaxChars}
          onChange={(event) => {
            const value = event.target.value;
            if (value === '') {
              update({ ackMaxChars: '' });
              return;
            }
            const parsedValue = parseInt(value, 10);
            update({ ackMaxChars: Number.isFinite(parsedValue) ? parsedValue : '' });
          }}
          placeholder={h.ackDefaultPlaceholder}
        />
        <p className="mt-1 text-xs text-fg-subtle">{h.ackMaxCharsHint}</p>
      </div>

      <label className="flex cursor-pointer items-start gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="ui-checkbox mt-0.5"
          checked={form.isolatedSession}
          onChange={(event) => update({ isolatedSession: event.target.checked })}
        />
        <span>
          {h.isolatedSession}
          <span className="mt-1 block text-xs text-fg-subtle">{h.isolatedSessionHint}</span>
        </span>
      </label>
    </>
  );
}

import { ExternalLink, Heart, Loader2, Play, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { getSessionChatIds, type ChannelStatus, type SessionChatId } from '@/features/cron/cron-api';
import { formatRecipientOptionLabel } from '@/features/cron/cron-utils';
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
import { SettingsFormSection } from '@/features/settings/settings-form-section';
import { nativeSelectMaxWidthClass, selectControlBaseClass, settingsInputFocusClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { messages, type HeartbeatSettingsMessages } from '@/i18n/messages';
import { ScheduleField } from '@/features/scheduling/schedule-field';
import { docsGuidePageUrl } from '@/navigation';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle',
    settingsInputFocusClass,
    'dark:border-edge',
  );
}

function selectClassName(): string {
  return cn(selectControlBaseClass, nativeSelectMaxWidthClass);
}

type CronMessages = ReturnType<typeof messages>['cron'];

function workspacePathFromConfig(cfg: unknown): string {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return '';
  const agents = (cfg as { agents?: unknown }).agents;
  if (!agents || typeof agents !== 'object' || Array.isArray(agents)) return '';
  const defaults = (agents as { defaults?: unknown }).defaults;
  if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) return '';
  const w = (defaults as { workspace?: unknown }).workspace;
  return typeof w === 'string' ? w : '';
}

export function HeartbeatSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const h = m.heartbeatSettings;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [form, setForm] = useState<HeartbeatSettingsState | null>(null);
  const [baseline, setBaseline] = useState<HeartbeatSettingsState | null>(null);
  const [doc, setDoc] = useState<string>('');
  const [docBaseline, setDocBaseline] = useState<string>('');
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingDoc, setSavingDoc] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveConfigOk, setSaveConfigOk] = useState(false);
  const [saveDocOk, setSaveDocOk] = useState(false);
  const [triggerLoading, setTriggerLoading] = useState(false);
  const [triggerOk, setTriggerOk] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [sessionChatIds, setSessionChatIds] = useState<SessionChatId[]>([]);

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

  const dirtyDoc = useMemo(() => doc !== docBaseline, [doc, docBaseline]);

  useEffect(() => {
    if (!hasToken) {
      setForm(null);
      setBaseline(null);
      return;
    }
    if (cfgData === undefined) return;
    if (!dirtyConfig) {
      const next = structuredClone(heartbeatParsed);
      setForm(next);
      setBaseline(next);
      setSaveConfigOk(false);
    }
  }, [hasToken, cfgData, heartbeatParsed, dirtyConfig]);

  useEffect(() => {
    if (!hasToken || mdContent === undefined) return;
    if (!dirtyDoc) {
      setDoc(mdContent);
      setDocBaseline(mdContent);
      setSaveDocOk(false);
    }
  }, [hasToken, mdContent, dirtyDoc]);

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

  useEffect(() => {
    if (!hasToken || !form) {
      setSessionChatIds([]);
      return;
    }
    const t = form.target.trim();
    if (!t) {
      setSessionChatIds([]);
      return;
    }
    let cancelled = false;
    void getSessionChatIds(t).then((ids) => {
      if (!cancelled) setSessionChatIds(ids);
    });
    return () => {
      cancelled = true;
    };
  }, [hasToken, form?.target]);

  const refreshSessionChatIds = useCallback(() => {
    const t = form?.target?.trim();
    if (!t) return;
    void getSessionChatIds(t).then(setSessionChatIds);
  }, [form?.target]);

  const runHeartbeatNow = useCallback(async () => {
    setTriggerLoading(true);
    setTriggerOk(false);
    setTriggerError(null);
    try {
      await triggerHeartbeat();
      setTriggerOk(true);
      window.setTimeout(() => setTriggerOk(false), 3000);
    } catch (e) {
      setTriggerError(e instanceof Error ? e.message : h.triggerError);
    } finally {
      setTriggerLoading(false);
    }
  }, [h.triggerError]);

  const update = useCallback((patch: Partial<HeartbeatSettingsState>) => {
    setForm((f) => (f ? { ...f, ...patch } : null));
  }, []);

  const discardConfiguration = useCallback(() => {
    if (!baseline) return;
    setForm(structuredClone(baseline));
    setSaveConfigOk(false);
    setError(null);
  }, [baseline]);

  const discardDocument = useCallback(() => {
    setDoc(docBaseline);
    setSaveDocOk(false);
    setError(null);
  }, [docBaseline]);

  const saveConfiguration = useCallback(async () => {
    if (!form || savingConfig) return;
    setSavingConfig(true);
    setError(null);
    setSaveConfigOk(false);
    try {
      await patchHeartbeatSettings(form);
      const next = structuredClone(form);
      setBaseline(next);
      setSaveConfigOk(true);
      window.setTimeout(() => setSaveConfigOk(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : h.saveConfigError);
    } finally {
      setSavingConfig(false);
    }
  }, [form, savingConfig, h.saveConfigError]);

  const saveDocument = useCallback(async () => {
    if (savingDoc) return;
    setSavingDoc(true);
    setError(null);
    setSaveDocOk(false);
    try {
      await putHeartbeatMd(doc);
      setDocBaseline(doc);
      setSaveDocOk(true);
      window.setTimeout(() => setSaveDocOk(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : h.saveDocError);
    } finally {
      setSavingDoc(false);
    }
  }, [doc, savingDoc, h.saveDocError]);

  if (!hasToken) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
        <h1 className="text-lg font-semibold text-fg">{m.settingsSections.heartbeat}</h1>
        <p className="text-sm text-fg-muted">{h.needToken}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <Loader2 className="size-4 animate-spin" />
          {h.loading}
        </div>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
        <p className="text-sm text-fg-muted">{error ?? fetchError ?? h.loadError}</p>
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
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-fg">{m.settingsSections.heartbeat}</h1>
          <p className="mt-1 text-sm text-fg-muted">{h.subtitle}</p>
          <a
            href={docsGuidePageUrl(language, 'heartbeat')}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {h.docsLink}
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </header>

      {workspacePath ? (
        <p className="text-xs text-fg-subtle">
          {h.workspaceLabel}: <span className="font-mono text-fg-muted">{workspacePath}</span>
        </p>
      ) : null}

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <SettingsFormSection>
        <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Heart className="size-4 text-accent" strokeWidth={1.75} />
            {h.configSection}
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
          </div>
        </div>
        <p className="mb-4 text-xs text-fg-subtle">{h.triggerHint}</p>
        {triggerError ? <p className="mb-3 text-sm text-red-600 dark:text-red-400">{triggerError}</p> : null}
        <HeartbeatConfigFields
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
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {saveConfigOk ? <span className="text-sm text-fg-muted">{h.savedConfig}</span> : null}
          <Button
            type="button"
            variant="secondary"
            disabled={!dirtyConfig || savingConfig}
            onClick={discardConfiguration}
          >
            {h.discard}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!dirtyConfig || savingConfig}
            onClick={() => void saveConfiguration()}
          >
            {savingConfig ? h.savingConfig : h.saveConfig}
          </Button>
          {dirtyConfig ? <span className="text-xs text-amber-800 dark:text-amber-200">{h.unsavedConfig}</span> : null}
        </div>
      </SettingsFormSection>

      <SettingsFormSection>
        <div className="mb-2 text-sm font-semibold text-fg">{h.docSection}</div>
        <p className="mb-3 text-xs text-fg-subtle">{h.docHint}</p>
        <textarea
          className={cn(inputClassName(), 'min-h-[12rem] resize-y font-mono text-xs leading-relaxed')}
          value={doc}
          onChange={(e) => setDoc(e.target.value)}
          spellCheck={false}
          aria-label={h.docSection}
        />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {saveDocOk ? <span className="text-sm text-fg-muted">{h.savedDoc}</span> : null}
          <Button type="button" variant="secondary" disabled={!dirtyDoc || savingDoc} onClick={discardDocument}>
            {h.discard}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!dirtyDoc || savingDoc}
            onClick={() => void saveDocument()}
          >
            {savingDoc ? h.savingDoc : h.saveDoc}
          </Button>
          {dirtyDoc ? <span className="text-xs text-amber-800 dark:text-amber-200">{h.unsavedDoc}</span> : null}
        </div>
      </SettingsFormSection>
    </div>
  );
}

function HeartbeatConfigFields({
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
  const channelNames = useMemo(() => new Set(channels.map((x) => x.name)), [channels]);
  const targetTrim = form.target.trim();
  const showCustomChannel = Boolean(targetTrim && !channelNames.has(targetTrim));

  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="ui-checkbox"
          checked={form.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
        />
        {h.enable}
      </label>

      <label className="flex cursor-pointer items-start gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="ui-checkbox mt-0.5"
          checked={form.includeSystemPromptSection}
          onChange={(e) => update({ includeSystemPromptSection: e.target.checked })}
        />
        <span>
          {h.includeSystemPromptSection}
          <span className="mt-1 block text-xs text-fg-subtle">{h.includeSystemPromptSectionHint}</span>
        </span>
      </label>

      <ScheduleField
        kind="interval"
        label={h.interval}
        valueMs={form.intervalMs}
        onChangeMs={(intervalMs) => update({ intervalMs })}
        labels={{ secondsLabel: h.intervalSecondsLabel, presets: h.intervalPresets }}
        hint={`${h.intervalHintPreset} ${h.intervalHint}`}
      />

      <div className="border-t border-edge-subtle pt-4">
        <div className="mb-2 text-sm font-medium text-fg">{h.deliveryTitle}</div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">{c.channel}</span>
          <select
            className={selectCn()}
            value={targetTrim}
            onChange={(e) => {
              const v = e.target.value.trim();
              update({ target: v, targetChatId: '' });
            }}
          >
            <option value="">{h.channelNone}</option>
            {showCustomChannel ? (
              <option value={targetTrim}>
                {targetTrim} ({h.customChannelSuffix})
              </option>
            ) : null}
            {channels.map((ch) => (
              <option key={ch.name} value={ch.name} disabled={!ch.enabled}>
                {ch.name} {!ch.enabled ? '(disabled)' : ''}
              </option>
            ))}
          </select>
        </label>

        {targetTrim ? (
          <div className="mt-3 flex flex-col gap-1">
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
                onChange={(e) => update({ targetChatId: e.target.value })}
                placeholder={c.recipientPlaceholder}
                autoComplete="off"
              />
              <select
                className={cn(selectCn(), 'max-w-[10rem] shrink-0 text-xs')}
                value={form.targetChatId}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) update({ targetChatId: v });
                }}
              >
                <option value="">{c.selectRecipient}</option>
                {sessionChatIds.length > 0 ? (
                  sessionChatIds.map((item) => (
                    <option key={`${item.channel}-${item.chatId}`} value={item.chatId}>
                      {formatRecipientOptionLabel(item, c.lastActiveLabels)}
                    </option>
                  ))
                ) : (
                  <option value="" disabled>
                    {c.noRecentChatsOption}
                  </option>
                )}
              </select>
            </div>
            <p className="text-xs text-fg-muted">
              {sessionChatIds.length > 0 ? c.enterManuallyOrSelect : c.noRecentChats}
            </p>
          </div>
        ) : null}

        <p className="mt-2 text-xs text-fg-subtle">{h.deliveryHint}</p>
      </div>

      <div>
        <div className="mb-1 text-sm font-medium text-fg">{h.prompt}</div>
        <textarea
          className={cn(inputCn(), 'min-h-[4.5rem] resize-y font-mono text-xs')}
          value={form.prompt}
          onChange={(e) => update({ prompt: e.target.value })}
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
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') update({ ackMaxChars: '' });
            else {
              const n = parseInt(v, 10);
              update({ ackMaxChars: Number.isFinite(n) ? n : '' });
            }
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
          onChange={(e) => update({ isolatedSession: e.target.checked })}
        />
        <span>
          {h.isolatedSession}
          <span className="mt-1 block text-xs text-fg-subtle">{h.isolatedSessionHint}</span>
        </span>
      </label>

      <div className="border-t border-edge-subtle pt-4">
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
      </div>
    </div>
  );
}

import { Bell, Loader2, Plus, Target, Trash2, type LucideIcon } from 'lucide-react';
import { useCallback, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { PageTabs, type PageTabItem } from '@/components/ui/page-tabs';
import { ModelSelector } from '@/features/chat/model/model-selector';
import { useGatewayConfigSwr } from '@/features/gateway/gateway-config-swr';
import { useChannelCatalog } from '@/features/settings/channels/use-channel-catalog';
import { listSessions } from '@/features/sessions/session-api';
import {
  normalizeGoalsConfigFromConfig,
  patchGoalsConfig,
  type GoalsConfigState,
} from '@/features/settings/goals-config-api';
import { useSaveBarRegistration } from '@/features/settings/save-bar/use-save-bar-registration';
import {
  SettingsTabPanel,
} from '@/features/settings/settings-page-layout';
import { settingsInputFocusClass } from '@/lib/form-field-width';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { Select, SelectOption } from '@/components/ui/popover-select';

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    settingsInputFocusClass,
    'dark:border-edge',
  );
}

const GOAL_NOTIFICATION_EVENTS = [
  'done',
  'blocked',
  'needs_input',
  'queue_failed',
  'queue_retry',
  'queue_succeeded',
  'queue_skipped',
];

type GoalsSettingsTabId = 'judge' | 'notifications';

const GOALS_SETTINGS_TABS: readonly GoalsSettingsTabId[] = ['judge', 'notifications'];

const GOALS_SETTINGS_TAB_ICONS: Record<GoalsSettingsTabId, LucideIcon> = {
  judge: Target,
  notifications: Bell,
};

function parseGoalsSettingsTab(raw: string | null): GoalsSettingsTabId {
  if (raw && GOALS_SETTINGS_TABS.includes(raw as GoalsSettingsTabId)) {
    return raw as GoalsSettingsTabId;
  }
  return 'judge';
}

function goalsSettingsTabLabel(t: ReturnType<typeof messages>['goalsSettings'], tab: GoalsSettingsTabId): string {
  return tab === 'judge' ? t.tabJudge : t.tabNotifications;
}

function goalsSettingsTabHint(t: ReturnType<typeof messages>['goalsSettings'], tab: GoalsSettingsTabId): string {
  return tab === 'judge' ? t.tabJudgeHint : t.tabNotificationsHint;
}

const FALLBACK_NOTIFICATION_CHANNELS = [
  { id: 'telegram', label: 'Telegram' },
  { id: 'weixin', label: 'Weixin' },
  { id: 'feishu', label: 'Feishu' },
];

const CUSTOM_CHAT_ID_SENTINEL = '__custom__';

type ChannelOption = {
  id: string;
  label: string;
  configured?: boolean;
  enabled?: boolean;
};

type TargetConfig = GoalsConfigState['notifications']['targets'][number];

type PairingStateWire = {
  paired?: {
    fromConfig?: string[];
    fromCredentials?: string[];
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function accountOptionsFromConfig(config: unknown, channelId: string): string[] {
  const cfg = isRecord(config) ? config : {};
  const channels = isRecord(cfg.channels) ? cfg.channels : {};
  const channel = isRecord(channels[channelId]) ? channels[channelId] : {};
  const channelConfig = isRecord(channel.config) ? channel.config : channel;
  const accounts = isRecord(channelConfig.accounts) ? channelConfig.accounts : null;
  if (!accounts) return ['default'];
  const ids = Object.entries(accounts)
    .filter(([, value]) => !isRecord(value) || value.enabled !== false)
    .map(([id]) => id)
    .filter(Boolean)
    .sort();
  return ids.length ? ids : ['default'];
}

function accountFromSessionKey(key: string, channelId: string): string | null {
  const parts = key.split(':');
  const channelIndex = parts.indexOf(channelId);
  if (channelIndex < 0) return null;
  return parts[channelIndex + 1] || null;
}

function chatIdFromSessionKey(key: string, channelId: string): string | null {
  const parts = key.split(':');
  const channelIndex = parts.indexOf(channelId);
  if (channelIndex < 0) return null;
  const peerKindIndex = channelIndex + 2;
  return parts[peerKindIndex + 1] || null;
}

async function fetchPairingState(channelId: string, accountId: string): Promise<PairingStateWire> {
  const q = new URLSearchParams({ account: accountId || 'default' });
  const data = await fetchJson<{ ok?: boolean; payload?: PairingStateWire }>(
    apiUrl(`/api/channels/${encodeURIComponent(channelId)}/pairing?${q.toString()}`),
  );
  return data.payload ?? {};
}

function GoalNotificationTargetRow({
  target,
  index,
  config,
  channelOptions,
  labels,
  inputClass,
  onChange,
  onRemove,
}: {
  target: TargetConfig;
  index: number;
  config: unknown;
  channelOptions: ChannelOption[];
  labels: ReturnType<typeof messages>['goalsSettings'];
  inputClass: string;
  onChange: (index: number, next: TargetConfig) => void;
  onRemove: (index: number) => void;
}) {
  const channelId = target.channel || channelOptions[0]?.id || 'telegram';
  const accountOptions = useMemo(() => accountOptionsFromConfig(config, channelId), [config, channelId]);
  const accountId = target.accountId || accountOptions[0] || 'default';
  const { data: sessions } = useSWR(
    channelId ? ['goal-notification-sessions', channelId] : null,
    () => listSessions({ channel: channelId, limit: 200 }),
    { revalidateOnFocus: false },
  );
  const { data: pairingState } = useSWR(
    channelId && accountId ? ['goal-notification-pairing', channelId, accountId] : null,
    () => fetchPairingState(channelId, accountId),
    { revalidateOnFocus: false },
  );

  const chatOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const session of sessions?.items ?? []) {
      const sessionAccount = accountFromSessionKey(session.key, channelId);
      if (sessionAccount && accountId && sessionAccount !== accountId) continue;
      const chatId = session.sourceChatId || chatIdFromSessionKey(session.key, channelId);
      if (!chatId) continue;
      byId.set(chatId, session.name?.trim() ? `${session.name} (${chatId})` : chatId);
    }
    for (const id of pairingState?.paired?.fromConfig ?? []) {
      if (id) byId.set(id, byId.get(id) ?? `${id} (${labels.notificationsPaired})`);
    }
    for (const id of pairingState?.paired?.fromCredentials ?? []) {
      if (id) byId.set(id, byId.get(id) ?? `${id} (${labels.notificationsPaired})`);
    }
    return [...byId.entries()].map(([id, label]) => ({ id, label }));
  }, [accountId, channelId, labels.notificationsPaired, pairingState, sessions]);

  const selectedChatKnown = target.chatId && chatOptions.some((option) => option.id === target.chatId);
  const useCustomChat =
    chatOptions.length === 0 ||
    target.chatId === CUSTOM_CHAT_ID_SENTINEL ||
    (target.chatId && !selectedChatKnown);

  return (
    <div className="grid gap-2 rounded-md border border-edge/70 bg-surface-panel p-2">
      <div className="grid gap-2 sm:grid-cols-[10rem_10rem_minmax(0,1fr)_2rem]">
        <Select
          className={inputClass}
          value={channelId}
          onChange={(e) => {
            const nextChannel = e.target.value;
            const nextAccounts = accountOptionsFromConfig(config, nextChannel);
            onChange(index, {
              ...target,
              channel: nextChannel,
              accountId: nextAccounts[0] || 'default',
              chatId: '',
            });
          }}
        >
          {channelOptions.map((channel) => (
            <SelectOption key={channel.id} value={channel.id}>
              {channel.label} ({channel.id})
            </SelectOption>
          ))}
        </Select>
        <Select
          className={inputClass}
          value={accountId}
          onChange={(e) => onChange(index, { ...target, accountId: e.target.value, chatId: '' })}
        >
          {accountOptions.map((account) => (
            <SelectOption key={account} value={account}>
              {account}
            </SelectOption>
          ))}
        </Select>
        {useCustomChat ? (
          <input
            className={inputClass}
            value={target.chatId === CUSTOM_CHAT_ID_SENTINEL ? '' : target.chatId}
            placeholder={labels.notificationsChatId}
            onChange={(e) => onChange(index, { ...target, chatId: e.target.value })}
          />
        ) : (
          <Select
            className={inputClass}
            value={target.chatId || chatOptions[0]?.id || ''}
            onChange={(e) =>
              onChange(index, {
                ...target,
                chatId: e.target.value === CUSTOM_CHAT_ID_SENTINEL ? CUSTOM_CHAT_ID_SENTINEL : e.target.value,
              })
            }
          >
            {target.chatId ? null : <SelectOption value="">{labels.notificationsChooseChat}</SelectOption>}
            {chatOptions.map((option) => (
              <SelectOption key={option.id} value={option.id}>
                {option.label}
              </SelectOption>
            ))}
            <SelectOption value={CUSTOM_CHAT_ID_SENTINEL}>{labels.notificationsCustomChat}</SelectOption>
          </Select>
        )}
        <Button
          type="button"
          variant="ghost"
          className="size-9 p-0 text-destructive hover:text-destructive"
          title={labels.notificationsRemoveTarget}
          onClick={() => onRemove(index)}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>
      {chatOptions.length > 0 && useCustomChat ? (
        <button
          type="button"
          className="w-fit text-xs text-accent hover:underline"
          onClick={() => onChange(index, { ...target, chatId: chatOptions[0]?.id ?? '' })}
        >
          {labels.notificationsUseKnownChat}
        </button>
      ) : null}
    </div>
  );
}

function GoalsSettingsTabNav({
  t,
  activeTab,
  onChange,
}: {
  t: ReturnType<typeof messages>['goalsSettings'];
  activeTab: GoalsSettingsTabId;
  onChange: (tab: GoalsSettingsTabId) => void;
}) {
  const items: PageTabItem<GoalsSettingsTabId>[] = GOALS_SETTINGS_TABS.map((tab) => ({
    id: tab,
    label: goalsSettingsTabLabel(t, tab),
    icon: GOALS_SETTINGS_TAB_ICONS[tab],
  }));
  return (
    <PageTabs
      items={items}
      activeTab={activeTab}
      onChange={onChange}
      ariaLabel={t.tabsAriaLabel}
      tabIdPrefix="goals-settings-tab"
      panelIdPrefix="goals-settings-panel"
    />
  );
}

function GoalsTabPanel({
  t,
  id,
  activeTab,
  children,
}: {
  t: ReturnType<typeof messages>['goalsSettings'];
  id: GoalsSettingsTabId;
  activeTab: GoalsSettingsTabId;
  children: ReactNode;
}) {
  return (
    <SettingsTabPanel
      id={id}
      activeTab={activeTab}
      tabIdPrefix="goals-settings-tab"
      panelIdPrefix="goals-settings-panel"
      title={goalsSettingsTabLabel(t, id)}
      hint={goalsSettingsTabHint(t, id)}
    >
      <div className="space-y-4">{children}</div>
    </SettingsTabPanel>
  );
}

type GoalsFormDraft = {
  form: GoalsConfigState | null;
  baseline: GoalsConfigState | null;
};

type GoalsFormAction =
  | { type: 'reset' }
  | { type: 'sync'; value: GoalsConfigState }
  | { type: 'patch'; patch: Partial<GoalsConfigState> }
  | { type: 'discard' }
  | { type: 'saved'; value: GoalsConfigState };

function goalsFormReducer(state: GoalsFormDraft, action: GoalsFormAction): GoalsFormDraft {
  switch (action.type) {
    case 'reset':
      return { form: null, baseline: null };
    case 'sync': {
      const snapshot = structuredClone(action.value);
      return { form: snapshot, baseline: structuredClone(snapshot) };
    }
    case 'patch':
      return { ...state, form: state.form ? { ...state.form, ...action.patch } : null };
    case 'discard':
      return state.baseline
        ? { form: structuredClone(state.baseline), baseline: state.baseline }
        : state;
    case 'saved': {
      const snapshot = structuredClone(action.value);
      return { form: snapshot, baseline: structuredClone(snapshot) };
    }
  }
}

export function GoalsConfigSection({ hasToken }: { hasToken: boolean }) {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).goalsSettings;
  const chatM = messages(language).chat;
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseGoalsSettingsTab(searchParams.get('tab'));
  const setActiveTab = useCallback(
    (tab: GoalsSettingsTabId) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (tab === 'judge') next.delete('tab');
          else next.set('tab', tab);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const { data, isLoading } = useGatewayConfigSwr(hasToken);
  const { entries: channelEntries } = useChannelCatalog(hasToken, language);
  const parsed = useMemo(
    () => (data?.payload?.config !== undefined ? normalizeGoalsConfigFromConfig(data.payload.config) : null),
    [data],
  );
  const [formDraft, dispatchForm] = useReducer(goalsFormReducer, { form: null, baseline: null });
  const form = formDraft.form;
  const baseline = formDraft.baseline;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const trackedParsedRef = useRef<GoalsConfigState | null>(null);

  if (!hasToken) {
    if (trackedParsedRef.current !== null) {
      trackedParsedRef.current = null;
      dispatchForm({ type: 'reset' });
      dirtyRef.current = false;
    }
  } else if (parsed !== null && !dirtyRef.current && trackedParsedRef.current !== parsed) {
    trackedParsedRef.current = parsed;
    dispatchForm({ type: 'sync', value: parsed });
  }

  const dirty = Boolean(form && baseline && JSON.stringify(form) !== JSON.stringify(baseline));

  const update = useCallback((patch: Partial<GoalsConfigState>) => {
    dirtyRef.current = true;
    dispatchForm({ type: 'patch', patch });
  }, []);

  const discard = useCallback(() => {
    dispatchForm({ type: 'discard' });
    dirtyRef.current = false;
    setError(null);
  }, []);

  const save = useCallback(async () => {
    if (!form || saving) return;
    setSaving(true);
    setError(null);
    try {
      await patchGoalsConfig(form);
      dirtyRef.current = false;
      dispatchForm({ type: 'saved', value: form });
    } catch (e) {
      const message = e instanceof Error ? e.message : t.saveError;
      setError(message);
      throw new Error(message);
    } finally {
      setSaving(false);
    }
  }, [form, saving, t.saveError]);

  useSaveBarRegistration({ id: 'goals', dirty, saving, save, discard });

  const updateNotifications = useCallback((patch: Partial<GoalsConfigState['notifications']>) => {
    if (!form) return;
    update({ notifications: { ...form.notifications, ...patch } });
  }, [form, update]);

  const notificationChannelOptions = useMemo(() => {
    const byId = new Map<string, { id: string; label: string; configured?: boolean; enabled?: boolean }>();
    for (const entry of channelEntries) {
      byId.set(entry.id, {
        id: entry.id,
        label: entry.label || entry.id,
        configured: entry.configured,
        enabled: entry.enabled,
      });
    }
    for (const fallback of FALLBACK_NOTIFICATION_CHANNELS) {
      if (!byId.has(fallback.id)) byId.set(fallback.id, fallback);
    }
    for (const selected of form?.notifications.channels ?? []) {
      if (!byId.has(selected)) byId.set(selected, { id: selected, label: selected });
    }
    return [...byId.values()].sort((a, b) => {
      const aw = a.enabled ? 0 : a.configured ? 1 : 2;
      const bw = b.enabled ? 0 : b.configured ? 1 : 2;
      if (aw !== bw) return aw - bw;
      return a.label.localeCompare(b.label);
    });
  }, [channelEntries, form?.notifications.channels]);

  if (!hasToken || !form) {
    return isLoading ? (
      <div className="rounded-2xl border border-edge bg-surface-base px-4 py-5 sm:px-5">
        <Loader2 className="size-4 animate-spin text-fg-muted" />
      </div>
    ) : null;
  }

  return (
    <>
      {error ? <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      <GoalsSettingsTabNav t={t} activeTab={activeTab} onChange={setActiveTab} />

      <GoalsTabPanel t={t} id="judge" activeTab={activeTab}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-fg">{t.maxTurns}</label>
            <input type="number" min={1} max={500} className={inputClassName()} value={form.maxTurns} onChange={(e) => update({ maxTurns: Number(e.target.value) || 20 })} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-fg">{t.judgeModelRef}</label>
            <ModelSelector
              value={form.judgeModelRef}
              placeholder={t.judgeModelRefPlaceholder}
              searchPlaceholder={chatM.modelSearchPlaceholder}
              noMatches={chatM.modelNoMatches}
              className="w-full max-w-none min-w-0"
              onChange={(modelId) => update({ judgeModelRef: modelId })}
            />
            {form.judgeModelRef.trim() ? (
              <button
                type="button"
                className="mt-1 text-xs text-accent hover:underline"
                onClick={() => update({ judgeModelRef: '' })}
              >
                {t.judgeModelRefUseDefault}
              </button>
            ) : (
              <p className="mt-1 text-xs text-fg-subtle">{t.judgeModelRefHint}</p>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-fg sm:col-span-2">
            <input type="checkbox" className="ui-checkbox" checked={form.checklistMode} onChange={(e) => update({ checklistMode: e.target.checked })} />
            {t.checklistMode}
          </label>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-fg">{t.checklistDecomposePolicy}</label>
            <Select
              className={inputClassName()}
              value={form.checklistDecomposePolicy}
              disabled={!form.checklistMode}
              onChange={(e) =>
                update({
                  checklistDecomposePolicy: e.target.value === 'supplement_existing'
                    ? 'supplement_existing'
                    : 'empty_only',
                })
              }
            >
              <SelectOption value="empty_only">{t.checklistDecomposePolicyEmptyOnly}</SelectOption>
              <SelectOption value="supplement_existing">{t.checklistDecomposePolicySupplementExisting}</SelectOption>
            </Select>
            <p className="mt-1 text-xs text-fg-subtle">{t.checklistDecomposePolicyHint}</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-fg">{t.parseFailures}</label>
            <input type="number" min={1} max={20} className={inputClassName()} value={form.maxConsecutiveParseFailures} onChange={(e) => update({ maxConsecutiveParseFailures: Number(e.target.value) || 3 })} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-fg">{t.judgeTimeoutSec}</label>
            <input type="number" min={5} max={120} className={inputClassName()} value={form.judgeTimeoutSec} onChange={(e) => update({ judgeTimeoutSec: Number(e.target.value) || 60 })} />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-fg">{t.checklistHistoryChars}</label>
            <input type="number" min={0} max={100000} className={inputClassName()} value={form.checklistHistoryChars} onChange={(e) => update({ checklistHistoryChars: Math.max(0, Math.min(100_000, Math.floor(Number(e.target.value) || 0))) })} />
            <p className="mt-1 text-xs text-fg-subtle">{t.checklistHistoryCharsHint}</p>
          </div>
        </div>
      </GoalsTabPanel>

      <GoalsTabPanel t={t} id="notifications" activeTab={activeTab}>
        <div className="grid gap-3">
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              className="ui-checkbox"
              checked={form.notifications.enabled}
              onChange={(e) => updateNotifications({ enabled: e.target.checked })}
            />
            {t.notificationsEnabled}
          </label>
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              className="ui-checkbox"
              checked={form.notifications.includeLinkedSessions}
              onChange={(e) => updateNotifications({ includeLinkedSessions: e.target.checked })}
            />
            {t.notificationsLinkedSessions}
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-fg">{t.notificationsChannels}</label>
              <div className="rounded-lg border border-edge bg-surface-panel p-2">
                <div className="grid max-h-40 gap-1 overflow-y-auto pr-1">
                  {notificationChannelOptions.map((channel) => {
                    const selected = form.notifications.channels.includes(channel.id);
                    return (
                      <label
                        key={channel.id}
                        className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg hover:bg-surface-hover"
                      >
                        <input
                          type="checkbox"
                          className="ui-checkbox"
                          checked={selected}
                          onChange={(e) => {
                            const channels = e.target.checked
                              ? [...form.notifications.channels, channel.id]
                              : form.notifications.channels.filter((it) => it !== channel.id);
                            updateNotifications({ channels });
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate">{channel.label}</span>
                        <span className="shrink-0 text-xs text-fg-muted">{channel.id}</span>
                        {channel.enabled ? (
                          <span className="shrink-0 rounded-full border border-accent/40 bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent-fg">
                            {t.notificationsChannelEnabled}
                          </span>
                        ) : channel.configured ? (
                          <span className="shrink-0 rounded-full border border-edge px-1.5 py-0.5 text-[11px] text-fg-muted">
                            {t.notificationsChannelConfigured}
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-fg">{t.notificationsEvents}</label>
              <div className="flex flex-wrap gap-1.5">
                {GOAL_NOTIFICATION_EVENTS.map((event) => {
                  const selected = form.notifications.events.includes(event);
                  return (
                    <button
                      key={event}
                      type="button"
                      className={cn(
                        'rounded-md border px-2 py-1 text-xs',
                        selected
                          ? 'border-accent bg-accent-soft text-accent-fg'
                          : 'border-edge bg-surface-panel text-fg-muted hover:bg-surface-hover',
                      )}
                      onClick={() => {
                        const events = selected
                          ? form.notifications.events.filter((it) => it !== event)
                          : [...form.notifications.events, event];
                        updateNotifications({ events });
                      }}
                    >
                      {event}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-fg">{t.notificationsTargets}</div>
              <Button
                type="button"
                variant="secondary"
                className="h-8 gap-1.5 px-2.5 text-xs"
                onClick={() =>
                  updateNotifications({
                    targets: [
                      ...form.notifications.targets,
                      {
                        channel: notificationChannelOptions[0]?.id ?? 'telegram',
                        accountId: accountOptionsFromConfig(data?.payload?.config, notificationChannelOptions[0]?.id ?? 'telegram')[0] ?? 'default',
                        chatId: '',
                      },
                    ],
                  })
                }
              >
                <Plus className="size-3.5" aria-hidden />
                {t.notificationsAddTarget}
              </Button>
            </div>
            {form.notifications.targets.length ? (
              <div className="grid gap-2">
                {form.notifications.targets.map((target, index) => (
                  <GoalNotificationTargetRow
                    key={index}
                    target={target}
                    index={index}
                    config={data?.payload?.config}
                    channelOptions={notificationChannelOptions}
                    labels={t}
                    inputClass={inputClassName()}
                    onChange={(rowIndex, next) => {
                      const targets = [...form.notifications.targets];
                      targets[rowIndex] = next;
                      updateNotifications({ targets });
                    }}
                    onRemove={(rowIndex) =>
                      updateNotifications({
                        targets: form.notifications.targets.filter((_, i) => i !== rowIndex),
                      })
                    }
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-fg-muted">{t.notificationsNoTargets}</p>
            )}
          </div>
        </div>
      </GoalsTabPanel>
    </>
  );
}

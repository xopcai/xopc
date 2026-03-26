import { Check, ChevronDown, Copy, ExternalLink, Eye, EyeOff, MessageSquare, Send } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  fetchChannelsSettings,
  patchChannelsSettings,
  type ChannelsSettingsState,
  type DmPolicy,
  type GroupPolicy,
  type ReplyToMode,
  type StreamMode,
} from '@/features/settings/channels-config-api';
import { nativeSelectMaxWidthClass, selectControlBaseClass } from '@/lib/form-field-width';
import { cn } from '@/lib/cn';
import { messages, type ChannelsSettingsMessages } from '@/i18n/messages';
import { docsGuidePageUrl } from '@/navigation';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

function inputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle focus:border-edge-strong focus:outline-none focus:ring-2 focus:ring-accent/30',
    'dark:border-edge',
  );
}

function selectClassName(): string {
  return cn(selectControlBaseClass, nativeSelectMaxWidthClass);
}

function parseIdList(raw: string): (string | number)[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/^-?\d+$/.test(s) ? Number(s) : s));
}

function joinAllowFrom(ids: (string | number)[]): string {
  return ids.map(String).join(', ');
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <div className="text-sm font-medium text-fg">{children}</div>;
}

function FieldHint({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-fg-subtle">{children}</p>;
}

type SelectFieldProps<T extends string> = {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
};

function SelectField<T extends string>({ label, value, onChange, options }: SelectFieldProps<T>) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <select className={selectClassName()} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ChannelsSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const ch = m.channelsSettings;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [form, setForm] = useState<ChannelsSettingsState | null>(null);
  const [baseline, setBaseline] = useState<ChannelsSettingsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const [tgExpanded, setTgExpanded] = useState(true);
  const [wxExpanded, setWxExpanded] = useState(true);
  const [tgAdvanced, setTgAdvanced] = useState(false);
  const [wxAdvanced, setWxAdvanced] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState(false);

  const [tgAccountsDraft, setTgAccountsDraft] = useState('');
  const [tgAccountsError, setTgAccountsError] = useState('');
  const [wxAccountsDraft, setWxAccountsDraft] = useState('');
  const [wxAccountsError, setWxAccountsError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchChannelsSettings();
      setForm(data);
      setBaseline(structuredClone(data));
      setTgAccountsDraft(JSON.stringify(data.telegram.accounts ?? {}, null, 2));
      setTgAccountsError('');
      setWxAccountsDraft(JSON.stringify(data.weixin.accounts ?? {}, null, 2));
      setWxAccountsError('');
      setSaveOk(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : ch.loadError);
      setForm(null);
      setBaseline(null);
    } finally {
      setLoading(false);
    }
  }, [ch.loadError]);

  useEffect(() => {
    if (!hasToken) {
      setLoading(false);
      setForm(null);
      setBaseline(null);
      return;
    }
    void load();
  }, [hasToken, load]);

  const dirty = useMemo(() => {
    if (!form || !baseline) return false;
    return JSON.stringify(form) !== JSON.stringify(baseline);
  }, [form, baseline]);

  const updateTelegram = useCallback((patch: Partial<ChannelsSettingsState['telegram']>) => {
    setForm((f) => (f ? { ...f, telegram: { ...f.telegram, ...patch } } : null));
  }, []);

  const updateWeixin = useCallback((patch: Partial<ChannelsSettingsState['weixin']>) => {
    setForm((f) => (f ? { ...f, weixin: { ...f.weixin, ...patch } } : null));
  }, []);

  const save = useCallback(async () => {
    if (!form || saving) return;
    setSaving(true);
    setError(null);
    setSaveOk(false);
    try {
      await patchChannelsSettings(form);
      const next = structuredClone(form);
      setBaseline(next);
      setTgAccountsDraft(JSON.stringify(next.telegram.accounts ?? {}, null, 2));
      setTgAccountsError('');
      setWxAccountsDraft(JSON.stringify(next.weixin.accounts ?? {}, null, 2));
      setWxAccountsError('');
      setSaveOk(true);
      window.setTimeout(() => setSaveOk(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : ch.saveError);
    } finally {
      setSaving(false);
    }
  }, [form, saving, ch.saveError]);

  const copyToken = useCallback(async () => {
    const t = form?.telegram.botToken;
    if (!t) return;
    await navigator.clipboard.writeText(t).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [form?.telegram.botToken]);

  const onTgAccountsBlur = useCallback(() => {
    if (!form) return;
    const raw = tgAccountsDraft.trim();
    if (!raw) {
      updateTelegram({ accounts: {} });
      setTgAccountsError('');
      return;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(ch.jsonObjectAccounts);
      }
      updateTelegram({ accounts: parsed as ChannelsSettingsState['telegram']['accounts'] });
      setTgAccountsError('');
    } catch (err) {
      setTgAccountsError(err instanceof Error ? err.message : ch.jsonInvalid);
    }
  }, [form, tgAccountsDraft, updateTelegram, ch.jsonObjectAccounts, ch.jsonInvalid]);

  const onWxAccountsBlur = useCallback(() => {
    if (!form) return;
    const raw = wxAccountsDraft.trim();
    if (!raw) {
      updateWeixin({ accounts: {} });
      setWxAccountsError('');
      return;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(ch.jsonObjectAccounts);
      }
      updateWeixin({ accounts: parsed as ChannelsSettingsState['weixin']['accounts'] });
      setWxAccountsError('');
    } catch (err) {
      setWxAccountsError(err instanceof Error ? err.message : ch.jsonInvalid);
    }
  }, [form, wxAccountsDraft, updateWeixin, ch.jsonObjectAccounts, ch.jsonInvalid]);

  const dmOpts = useMemo(
    () =>
      (['pairing', 'allowlist', 'open', 'disabled'] as DmPolicy[]).map((value) => ({
        value,
        label: ch.policy.dm[value],
      })),
    [ch.policy.dm],
  );

  const groupOpts = useMemo(
    () =>
      (['open', 'disabled', 'allowlist'] as GroupPolicy[]).map((value) => ({
        value,
        label: ch.policy.group[value],
      })),
    [ch.policy.group],
  );

  const replyOpts = useMemo(
    () =>
      (['off', 'first', 'all'] as ReplyToMode[]).map((value) => ({
        value,
        label: ch.policy.reply[value],
      })),
    [ch.policy.reply],
  );

  const streamOpts = useMemo(
    () =>
      (['off', 'partial', 'block'] as StreamMode[]).map((value) => ({
        value,
        label: ch.policy.stream[value],
      })),
    [ch.policy.stream],
  );

  if (!hasToken) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
        <h1 className="text-lg font-semibold text-fg">{m.settingsSections.channels}</h1>
        <p className="text-sm text-fg-muted">{ch.needToken}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-app-main px-4 py-8">
        <div className="h-8 w-48 animate-pulse rounded bg-surface-hover" />
        <div className="mt-6 h-32 animate-pulse rounded-xl bg-surface-hover" />
        <p className="mt-4 text-sm text-fg-muted">{ch.loading}</p>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-3 px-4 py-8">
        <p className="text-sm text-fg-muted">{error ?? ch.loadError}</p>
        <Button type="button" variant="secondary" onClick={() => void load()}>
          {ch.retry}
        </Button>
      </div>
    );
  }

  const tg = form.telegram;
  const wx = form.weixin;
  const showTgBody = tg.enabled && tgExpanded;
  const showWxBody = wx.enabled && wxExpanded;

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-fg">{m.settingsSections.channels}</h1>
          <p className="mt-1 text-sm text-fg-muted">{ch.subtitle}</p>
          <a
            href={docsGuidePageUrl(language, 'channels')}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {ch.docsLink}
            <ExternalLink className="size-3.5" />
          </a>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {saveOk ? <span className="text-sm text-fg-muted">{ch.saved}</span> : null}
          <Button
            type="button"
            variant="primary"
            disabled={!dirty || saving}
            onClick={() => void save()}
          >
            {saving ? ch.saving : ch.save}
          </Button>
        </div>
      </header>

      {dirty ? <p className="text-xs text-amber-800 dark:text-amber-200">{ch.unsavedHint}</p> : null}
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="flex flex-col gap-4">
        {/* Telegram */}
        <section
          className={cn(
            'overflow-hidden rounded-2xl bg-surface-base',
            tg.enabled && !tgExpanded && 'opacity-95',
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-edge-subtle bg-surface-hover/30 px-4 py-3 dark:border-edge-subtle">
            <button
              type="button"
              className={cn(
                'flex min-w-0 flex-1 items-start gap-3 text-left',
                tg.enabled && 'cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              )}
              tabIndex={tg.enabled ? 0 : -1}
              aria-expanded={tg.enabled ? tgExpanded : false}
              onClick={() => {
                if (!tg.enabled) return;
                setTgExpanded((e) => !e);
              }}
              onKeyDown={(e) => {
                if (!tg.enabled) return;
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                setTgExpanded((x) => !x);
              }}
            >
              <span
                className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-hover/80 dark:bg-surface-hover/50"
                aria-hidden
              >
                <Send className="size-4 text-accent" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-fg">{ch.telegramTitle}</h2>
                  {tg.enabled ? (
                    tgExpanded ? (
                      <ChevronDown className="size-4 text-fg-muted" />
                    ) : (
                      <ChevronDown className="size-4 rotate-[-90deg] text-fg-muted" />
                    )
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-fg-muted">{ch.telegramSubtitle}</p>
              </div>
            </button>
            <label
              className="flex shrink-0 cursor-pointer items-center gap-2"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <span className="sr-only">{ch.enableTelegramAria}</span>
              <input
                type="checkbox"
                className="ui-checkbox"
                checked={tg.enabled}
                onChange={(e) => {
                  const on = e.target.checked;
                  if (on) setTgExpanded(true);
                  updateTelegram({ enabled: on });
                }}
              />
            </label>
          </div>

          {showTgBody ? (
            <div className="space-y-4 px-4 py-4">
              <div className="flex flex-col gap-1.5">
                <FieldLabel>
                  {ch.telegramToken}
                  <span className="text-red-600 dark:text-red-400"> *</span>
                </FieldLabel>
                <div className="flex flex-wrap gap-2">
                  <input
                    className={cn(inputClassName(), 'min-w-0 flex-1 font-mono text-xs')}
                    type={showToken ? 'text' : 'password'}
                    autoComplete="off"
                    value={tg.botToken}
                    onChange={(e) => updateTelegram({ botToken: e.target.value })}
                    placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                  />
                  {tg.botToken ? (
                    <Button type="button" variant="secondary" className="px-2 py-1 text-xs" onClick={() => void copyToken()}>
                      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      {copied ? ch.copied : ch.copy}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    className="px-2 py-1 text-xs"
                    onClick={() => setShowToken((s) => !s)}
                  >
                    {showToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    {showToken ? ch.hide : ch.show}
                  </Button>
                </div>
                <FieldHint>{ch.telegramTokenDesc}</FieldHint>
              </div>

              <div className="flex flex-col gap-1.5">
                <FieldLabel>{ch.allowFromDm}</FieldLabel>
                <textarea
                  className={cn(inputClassName(), 'min-h-[2.75rem] resize-y font-mono text-xs')}
                  rows={2}
                  placeholder="123456789, 987654321"
                  value={joinAllowFrom(tg.allowFrom)}
                  onChange={(e) => updateTelegram({ allowFrom: parseIdList(e.target.value) })}
                />
                <FieldHint>{ch.allowFromDmDesc}</FieldHint>
              </div>

              <Button
                type="button"
                variant="ghost"
                className="-ml-2 h-auto justify-start px-2 py-1 text-sm text-fg-muted hover:text-fg"
                onClick={() => setTgAdvanced((a) => !a)}
              >
                <ChevronDown className={cn('mr-1 size-4 transition-transform', tgAdvanced && 'rotate-180')} />
                {tgAdvanced ? ch.advancedHide : ch.advancedShow}
              </Button>

              {tgAdvanced ? (
                <TelegramAdvanced
                  tg={tg}
                  updateTelegram={updateTelegram}
                  ch={ch}
                  dmOpts={dmOpts}
                  groupOpts={groupOpts}
                  replyOpts={replyOpts}
                  streamOpts={streamOpts}
                  tgAccountsDraft={tgAccountsDraft}
                  setTgAccountsDraft={setTgAccountsDraft}
                  tgAccountsError={tgAccountsError}
                  onTgAccountsBlur={onTgAccountsBlur}
                />
              ) : null}
            </div>
          ) : null}
        </section>

        {/* Weixin */}
        <section
          className={cn(
            'overflow-hidden rounded-2xl bg-surface-base',
            wx.enabled && !wxExpanded && 'opacity-95',
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-edge-subtle bg-surface-hover/30 px-4 py-3 dark:border-edge-subtle">
            <button
              type="button"
              className={cn(
                'flex min-w-0 flex-1 items-start gap-3 text-left',
                wx.enabled && 'cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              )}
              tabIndex={wx.enabled ? 0 : -1}
              aria-expanded={wx.enabled ? wxExpanded : false}
              onClick={() => {
                if (!wx.enabled) return;
                setWxExpanded((e) => !e);
              }}
              onKeyDown={(e) => {
                if (!wx.enabled) return;
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                setWxExpanded((x) => !x);
              }}
            >
              <span
                className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-hover/80 dark:bg-surface-hover/50"
                aria-hidden
              >
                <MessageSquare className="size-4 text-accent" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-fg">{ch.weixinTitle}</h2>
                  {wx.enabled ? (
                    wxExpanded ? (
                      <ChevronDown className="size-4 text-fg-muted" />
                    ) : (
                      <ChevronDown className="size-4 rotate-[-90deg] text-fg-muted" />
                    )
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-fg-muted">{ch.weixinSubtitle}</p>
              </div>
            </button>
            <label className="flex shrink-0 cursor-pointer items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <span className="sr-only">{ch.enableWeixinAria}</span>
              <input
                type="checkbox"
                className="ui-checkbox"
                checked={wx.enabled}
                onChange={(e) => {
                  const on = e.target.checked;
                  if (on) setWxExpanded(true);
                  updateWeixin({ enabled: on });
                }}
              />
            </label>
          </div>

          {showWxBody ? (
            <div className="space-y-4 px-4 py-4">
              <p className="rounded-lg border border-edge-subtle bg-surface-base px-3 py-2 text-xs text-fg-muted dark:border-edge">
                {ch.weixinLoginCallout}
              </p>

              <div className="flex flex-col gap-1.5">
                <FieldLabel>{ch.weixinAllowFrom}</FieldLabel>
                <textarea
                  className={cn(inputClassName(), 'min-h-[2.75rem] resize-y font-mono text-xs')}
                  rows={2}
                  placeholder="wxid_..., openid_..."
                  value={wx.allowFrom.join(', ')}
                  onChange={(e) =>
                    updateWeixin({
                      allowFrom: e.target.value
                        .split(/[,\n]/)
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
                <FieldHint>{ch.weixinAllowFromDesc}</FieldHint>
              </div>

              <Button
                type="button"
                variant="ghost"
                className="-ml-2 h-auto justify-start px-2 py-1 text-sm text-fg-muted hover:text-fg"
                onClick={() => setWxAdvanced((a) => !a)}
              >
                <ChevronDown className={cn('mr-1 size-4 transition-transform', wxAdvanced && 'rotate-180')} />
                {wxAdvanced ? ch.advancedHide : ch.advancedShow}
              </Button>

              {wxAdvanced ? (
                <WeixinAdvanced
                  wx={wx}
                  updateWeixin={updateWeixin}
                  ch={ch}
                  dmOpts={dmOpts}
                  streamOpts={streamOpts}
                  wxAccountsDraft={wxAccountsDraft}
                  setWxAccountsDraft={setWxAccountsDraft}
                  wxAccountsError={wxAccountsError}
                  onWxAccountsBlur={onWxAccountsBlur}
                />
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function TelegramAdvanced({
  tg,
  updateTelegram,
  ch,
  dmOpts,
  groupOpts,
  replyOpts,
  streamOpts,
  tgAccountsDraft,
  setTgAccountsDraft,
  tgAccountsError,
  onTgAccountsBlur,
}: {
  tg: ChannelsSettingsState['telegram'];
  updateTelegram: (p: Partial<ChannelsSettingsState['telegram']>) => void;
  ch: ChannelsSettingsMessages;
  dmOpts: { value: DmPolicy; label: string }[];
  groupOpts: { value: GroupPolicy; label: string }[];
  replyOpts: { value: ReplyToMode; label: string }[];
  streamOpts: { value: StreamMode; label: string }[];
  tgAccountsDraft: string;
  setTgAccountsDraft: (s: string) => void;
  tgAccountsError: string;
  onTgAccountsBlur: () => void;
}) {
  return (
    <div className="space-y-4 border-t border-edge-subtle pt-4 dark:border-edge">
      <div className="flex flex-col gap-1.5">
        <FieldLabel>{ch.apiRoot}</FieldLabel>
        <input
          className={inputClassName()}
          value={tg.apiRoot}
          onChange={(e) => updateTelegram({ apiRoot: e.target.value })}
          placeholder="https://api.telegram.org"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>{ch.proxy}</FieldLabel>
        <input
          className={inputClassName()}
          value={tg.proxy}
          onChange={(e) => updateTelegram({ proxy: e.target.value })}
          placeholder="http://proxy.example.com:8080"
        />
      </div>
      <SelectField label={ch.dmPolicy} value={tg.dmPolicy} onChange={(v) => updateTelegram({ dmPolicy: v })} options={dmOpts} />
      <SelectField
        label={ch.groupPolicy}
        value={tg.groupPolicy}
        onChange={(v) => updateTelegram({ groupPolicy: v })}
        options={groupOpts}
      />
      <SelectField
        label={ch.replyToMode}
        value={tg.replyToMode}
        onChange={(v) => updateTelegram({ replyToMode: v })}
        options={replyOpts}
      />
      <SelectField
        label={ch.streamMode}
        value={tg.streamMode}
        onChange={(v) => updateTelegram({ streamMode: v })}
        options={streamOpts}
      />
      <div className="flex flex-col gap-1.5">
        <FieldLabel>{ch.allowFromGroups}</FieldLabel>
        <textarea
          className={cn(inputClassName(), 'min-h-[2.75rem] resize-y font-mono text-xs')}
          rows={2}
          placeholder="-1001234567890"
          value={joinAllowFrom(tg.groupAllowFrom)}
          onChange={(e) => updateTelegram({ groupAllowFrom: parseIdList(e.target.value) })}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{ch.historyLimit}</FieldLabel>
          <input
            type="number"
            min={10}
            max={200}
            className={inputClassName()}
            value={tg.historyLimit}
            onChange={(e) => updateTelegram({ historyLimit: parseInt(e.target.value, 10) || 50 })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{ch.textChunkLimit}</FieldLabel>
          <input
            type="number"
            min={1000}
            max={10000}
            step={100}
            className={inputClassName()}
            value={tg.textChunkLimit}
            onChange={(e) => updateTelegram({ textChunkLimit: parseInt(e.target.value, 10) || 4000 })}
          />
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="ui-checkbox"
          checked={tg.debug}
          onChange={(e) => updateTelegram({ debug: e.target.checked })}
        />
        {ch.telegramDebug}
      </label>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>{ch.multiAccountJson}</FieldLabel>
        <textarea
          className={cn(inputClassName(), 'min-h-[140px] resize-y font-mono text-xs')}
          spellCheck={false}
          value={tgAccountsDraft}
          onChange={(e) => setTgAccountsDraft(e.target.value)}
          onBlur={onTgAccountsBlur}
          placeholder='{ "personal": { "accountId": "personal", "botToken": "...", ... } }'
        />
        {tgAccountsError ? (
          <p className="text-xs text-red-600 dark:text-red-400">{tgAccountsError}</p>
        ) : (
          <FieldHint>{ch.multiAccountJsonDesc}</FieldHint>
        )}
      </div>
    </div>
  );
}

function WeixinAdvanced({
  wx,
  updateWeixin,
  ch,
  dmOpts,
  streamOpts,
  wxAccountsDraft,
  setWxAccountsDraft,
  wxAccountsError,
  onWxAccountsBlur,
}: {
  wx: ChannelsSettingsState['weixin'];
  updateWeixin: (p: Partial<ChannelsSettingsState['weixin']>) => void;
  ch: ChannelsSettingsMessages;
  dmOpts: { value: DmPolicy; label: string }[];
  streamOpts: { value: StreamMode; label: string }[];
  wxAccountsDraft: string;
  setWxAccountsDraft: (s: string) => void;
  wxAccountsError: string;
  onWxAccountsBlur: () => void;
}) {
  return (
    <div className="space-y-4 border-t border-edge-subtle pt-4 dark:border-edge">
      <SelectField label={ch.dmPolicy} value={wx.dmPolicy} onChange={(v) => updateWeixin({ dmPolicy: v })} options={dmOpts} />
      <SelectField
        label={ch.streamMode}
        value={wx.streamMode}
        onChange={(v) => updateWeixin({ streamMode: v })}
        options={streamOpts}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{ch.historyLimit}</FieldLabel>
          <input
            type="number"
            min={10}
            max={200}
            className={inputClassName()}
            value={wx.historyLimit}
            onChange={(e) => updateWeixin({ historyLimit: parseInt(e.target.value, 10) || 50 })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>{ch.textChunkLimit}</FieldLabel>
          <input
            type="number"
            min={1000}
            max={10000}
            step={100}
            className={inputClassName()}
            value={wx.textChunkLimit}
            onChange={(e) => updateWeixin({ textChunkLimit: parseInt(e.target.value, 10) || 4000 })}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>{ch.weixinRouteTag}</FieldLabel>
        <input
          className={inputClassName()}
          value={wx.routeTag}
          onChange={(e) => updateWeixin({ routeTag: e.target.value })}
          placeholder={ch.routeTagPlaceholder}
        />
        <FieldHint>{ch.weixinRouteTagDesc}</FieldHint>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="ui-checkbox"
          checked={wx.debug}
          onChange={(e) => updateWeixin({ debug: e.target.checked })}
        />
        {ch.weixinDebug}
      </label>
      <FieldHint>{ch.weixinDebugDesc}</FieldHint>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>{ch.weixinAccountsJson}</FieldLabel>
        <textarea
          className={cn(inputClassName(), 'min-h-[140px] resize-y font-mono text-xs')}
          spellCheck={false}
          value={wxAccountsDraft}
          onChange={(e) => setWxAccountsDraft(e.target.value)}
          onBlur={onWxAccountsBlur}
          placeholder='{ "personal": { "name": "...", "cdnBaseUrl": "...", "enabled": true } }'
        />
        {wxAccountsError ? (
          <p className="text-xs text-red-600 dark:text-red-400">{wxAccountsError}</p>
        ) : (
          <FieldHint>{ch.weixinAccountsJsonDesc}</FieldHint>
        )}
      </div>
    </div>
  );
}

import { Check, CheckCircle2, Copy, ExternalLink, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useId, useState, type RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { SettingsFormSection } from '@/features/settings/settings-form-section';
import { isMaskedKey } from '@/features/settings/providers-api';
import { revealTunnelRegistrationSecret } from '@/features/tunnel/tunnel-api';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { interaction } from '@/lib/interaction';
import type { TunnelSettingsMessages } from '@/i18n/messages';

export const TUNNEL_CONSOLE_REGISTRATION_KEY_URL = 'https://console.xopc.ai/keys/tunnel';

export type BrokerSecretSetupProps = {
  t: TunnelSettingsMessages;
  brokerSecretFromEnv: boolean;
  brokerSecretMissing: boolean;
  brokerSecretConfiguredInConfig: boolean;
  brokerSecretMaskedValue: string;
  brokerSecretDraft: string;
  savingBrokerSecret: boolean;
  brokerSecretNotice: string | null;
  copyFailedLabel: string;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
  sectionRef?: RefObject<HTMLDivElement | null>;
};

export function BrokerSecretSetupSection({
  t,
  brokerSecretFromEnv,
  brokerSecretMissing,
  brokerSecretConfiguredInConfig,
  brokerSecretMaskedValue,
  brokerSecretDraft,
  savingBrokerSecret,
  brokerSecretNotice,
  copyFailedLabel,
  onDraftChange,
  onSave,
  onClear,
  sectionRef,
}: BrokerSecretSetupProps) {
  const inputId = useId();
  const needsSetup = brokerSecretMissing && !brokerSecretFromEnv;
  const ready = !needsSetup;

  const [reconfiguring, setReconfiguring] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [revealed, setRevealed] = useState<string | null | undefined>(undefined);
  const [revealLoading, setRevealLoading] = useState(false);
  const [revealErr, setRevealErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const showStoredKeyRow =
    brokerSecretConfiguredInConfig && !brokerSecretFromEnv && !reconfiguring && !brokerSecretDraft.trim();

  useEffect(() => {
    if (!brokerSecretConfiguredInConfig) {
      setReconfiguring(false);
      setRevealed(undefined);
      setRevealErr(null);
      setShowKey(false);
    }
  }, [brokerSecretConfiguredInConfig]);

  useEffect(() => {
    if (brokerSecretNotice) {
      setReconfiguring(false);
    }
  }, [brokerSecretNotice]);

  const copyKey = useCallback(async () => {
    const text = typeof revealed === 'string' ? revealed : '';
    if (!text) return;
    const ok = await copyTextToClipboard(text);
    if (!ok) {
      setRevealErr(copyFailedLabel);
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [copyFailedLabel, revealed]);

  const toggleEye = useCallback(async () => {
    setRevealErr(null);
    if (revealed !== undefined) {
      setShowKey((s) => !s);
      return;
    }
    setRevealLoading(true);
    try {
      const payload = await revealTunnelRegistrationSecret();
      setRevealed(payload.registrationSecret ?? null);
      setShowKey(true);
    } catch (e) {
      setRevealErr(e instanceof Error ? e.message : t.brokerSecretRevealFailed);
      setRevealed(null);
    } finally {
      setRevealLoading(false);
    }
  }, [revealed, t.brokerSecretRevealFailed]);

  const canSave = brokerSecretDraft.trim().length > 0 && !isMaskedKey(brokerSecretDraft.trim());

  const cancelReconfigure = () => {
    setReconfiguring(false);
    setRevealErr(null);
    onDraftChange('');
  };

  return (
    <div ref={sectionRef} id="tunnel-broker-secret-setup">
      <SettingsFormSection className={cn(needsSetup && 'ring-1 ring-amber-500/30')}>
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-lg',
              ready
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : needsSetup
                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                  : 'bg-surface-hover text-fg-muted',
            )}
          >
            {ready ? (
              <Check className="size-4" strokeWidth={2} aria-hidden />
            ) : (
              <KeyRound className="size-4" strokeWidth={1.75} aria-hidden />
            )}
          </span>
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <p className="text-sm font-semibold text-fg">
                {ready ? t.brokerSecretReadyTitle : t.brokerSecretStepTitle}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-fg-muted">
                {ready ? t.brokerSecretReadyHint : t.brokerSecretHint}
              </p>
              {needsSetup ? (
                <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">{t.brokerSecretMissingHint}</p>
              ) : null}
            </div>

            <a
              href={TUNNEL_CONSOLE_REGISTRATION_KEY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1 text-xs font-medium text-accent-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {t.brokerSecretConsoleLink}
              <ExternalLink className="size-3" aria-hidden />
            </a>

            {brokerSecretFromEnv ? (
              <p className="rounded-lg border border-edge-subtle bg-surface-panel px-3 py-2 text-xs text-fg-muted">
                {t.brokerSecretEnvHint}
              </p>
            ) : null}

            {showStoredKeyRow ? (
              <>
                <p className="text-[11px] text-fg-subtle">{t.brokerSecretMaskedHelp}</p>
                <label className="sr-only" htmlFor={inputId}>
                  {t.brokerSecretTitle}
                </label>
                <div className="relative min-w-0">
                  <input
                    id={inputId}
                    type={showKey && typeof revealed === 'string' ? 'text' : 'password'}
                    readOnly
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full rounded-lg border border-edge bg-surface-panel py-2 pl-3 pr-24 font-mono text-sm text-fg"
                    value={
                      showKey && typeof revealed === 'string' ? revealed : brokerSecretMaskedValue
                    }
                  />
                  <div className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5">
                    {showKey && typeof revealed === 'string' && revealed.length > 0 ? (
                      <button
                        type="button"
                        className={cn(
                          'rounded p-1.5 text-fg-subtle hover:bg-surface-hover hover:text-fg',
                          interaction.transition,
                          interaction.press,
                          interaction.focusRingPanel,
                        )}
                        title={copied ? t.copied : t.copyKey}
                        aria-label={copied ? t.copied : t.copyKey}
                        onClick={() => void copyKey()}
                      >
                        {copied ? <CheckCircle2 className="size-4" /> : <Copy className="size-4" />}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={cn(
                        'rounded p-1.5 text-fg-subtle hover:bg-surface-hover hover:text-fg disabled:opacity-40',
                        interaction.transition,
                        interaction.press,
                        interaction.focusRingPanel,
                      )}
                      title={showKey ? t.hideKey : t.showKey}
                      aria-label={showKey ? t.hideKey : t.showKey}
                      disabled={revealLoading}
                      onClick={() => void toggleEye()}
                    >
                      {revealLoading ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : showKey ? (
                        <EyeOff className="size-4" aria-hidden />
                      ) : (
                        <Eye className="size-4" aria-hidden />
                      )}
                    </button>
                  </div>
                </div>
                {showKey && revealed === null && !revealErr ? (
                  <p className="text-xs text-amber-700 dark:text-amber-400/90">{t.brokerSecretNotInConfigFile}</p>
                ) : null}
                {revealErr ? <p className="text-xs text-red-600 dark:text-red-400">{revealErr}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={savingBrokerSecret}
                    onClick={() => {
                      setRevealErr(null);
                      setReconfiguring(true);
                    }}
                  >
                    {t.brokerSecretReconfigure}
                  </Button>
                  <Button type="button" variant="ghost" disabled={savingBrokerSecret} onClick={onClear}>
                    {t.brokerSecretClear}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <label className="sr-only" htmlFor={inputId}>
                  {t.brokerSecretTitle}
                </label>
                <input
                  id={inputId}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 font-mono text-sm text-fg placeholder:text-fg-subtle"
                  placeholder={
                    reconfiguring ? t.brokerSecretPlaceholder : t.brokerSecretPlaceholder
                  }
                  value={brokerSecretDraft}
                  disabled={savingBrokerSecret}
                  onChange={(e) => onDraftChange(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" disabled={savingBrokerSecret || !canSave} onClick={onSave}>
                    {savingBrokerSecret ? <Loader2 className="size-4 animate-spin" /> : null}
                    {needsSetup ? t.brokerSecretSaveAndContinue : t.brokerSecretSave}
                  </Button>
                  {brokerSecretConfiguredInConfig || brokerSecretFromEnv ? (
                    <Button type="button" variant="ghost" disabled={savingBrokerSecret} onClick={onClear}>
                      {t.brokerSecretClear}
                    </Button>
                  ) : null}
                  {reconfiguring ? (
                    <Button type="button" variant="ghost" disabled={savingBrokerSecret} onClick={cancelReconfigure}>
                      {t.brokerSecretCancelReconfigure}
                    </Button>
                  ) : null}
                </div>
              </>
            )}

            {brokerSecretNotice ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-400">{brokerSecretNotice}</p>
            ) : null}
          </div>
        </div>
      </SettingsFormSection>
    </div>
  );
}

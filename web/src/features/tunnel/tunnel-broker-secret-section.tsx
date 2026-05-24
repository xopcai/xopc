import { Check, KeyRound, Loader2 } from 'lucide-react';
import { useId, type RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { SettingsFormSection } from '@/features/settings/settings-form-section';
import { cn } from '@/lib/cn';
import type { TunnelSettingsMessages } from '@/i18n/messages';

export type BrokerSecretSetupProps = {
  t: TunnelSettingsMessages;
  variant: 'setup' | 'compact';
  brokerSecretFromEnv: boolean;
  brokerSecretMissing: boolean;
  brokerSecretConfiguredInConfig: boolean;
  brokerSecretDraft: string;
  savingBrokerSecret: boolean;
  brokerSecretNotice: string | null;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
  sectionRef?: RefObject<HTMLDivElement | null>;
};

export function BrokerSecretSetupSection({
  t,
  variant,
  brokerSecretFromEnv,
  brokerSecretMissing,
  brokerSecretConfiguredInConfig,
  brokerSecretDraft,
  savingBrokerSecret,
  brokerSecretNotice,
  onDraftChange,
  onSave,
  onClear,
  sectionRef,
}: BrokerSecretSetupProps) {
  const inputId = useId();
  const needsSetup = brokerSecretMissing && !brokerSecretFromEnv;
  const ready = !needsSetup;

  if (variant === 'compact' && ready) {
    return (
      <div ref={sectionRef} id="tunnel-broker-secret-setup">
        <SettingsFormSection className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <Check className="size-4" strokeWidth={2} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{t.brokerSecretReadyTitle}</p>
          <p className="mt-0.5 text-xs text-fg-muted">
            {brokerSecretFromEnv ? t.brokerSecretEnvHint : t.brokerSecretReadyHint}
          </p>
        </div>
      </SettingsFormSection>
      </div>
    );
  }

  return (
    <div ref={sectionRef} id="tunnel-broker-secret-setup">
      <SettingsFormSection className={cn(needsSetup && 'ring-1 ring-amber-500/30')}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg',
            needsSetup ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'bg-surface-hover text-fg-muted',
          )}
        >
          <KeyRound className="size-4" strokeWidth={1.75} aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-sm font-semibold text-fg">
              {variant === 'setup' ? t.brokerSecretStepTitle : t.brokerSecretTitle}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-fg-muted">{t.brokerSecretHint}</p>
            {needsSetup ? (
              <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">{t.brokerSecretMissingHint}</p>
            ) : null}
          </div>

          {brokerSecretFromEnv ? (
            <p className="rounded-lg border border-edge-subtle bg-surface-panel px-3 py-2 text-xs text-fg-muted">
              {t.brokerSecretEnvHint}
            </p>
          ) : (
            <>
              <label className="sr-only" htmlFor={inputId}>
                {t.brokerSecretTitle}
              </label>
              <input
                id={inputId}
                type="password"
                autoComplete="off"
                className="w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 font-mono text-sm text-fg"
                placeholder={
                  brokerSecretConfiguredInConfig ? t.brokerSecretPlaceholderKeep : t.brokerSecretPlaceholder
                }
                value={brokerSecretDraft}
                disabled={savingBrokerSecret}
                onChange={(e) => onDraftChange(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={savingBrokerSecret || !brokerSecretDraft.trim()}
                  onClick={onSave}
                >
                  {savingBrokerSecret ? <Loader2 className="size-4 animate-spin" /> : null}
                  {needsSetup ? t.brokerSecretSaveAndContinue : t.brokerSecretSave}
                </Button>
                {brokerSecretConfiguredInConfig ? (
                  <Button type="button" variant="ghost" disabled={savingBrokerSecret} onClick={onClear}>
                    {t.brokerSecretClear}
                  </Button>
                ) : null}
              </div>
            </>
          )}

          {brokerSecretNotice ? (
            <p className="text-xs text-emerald-700 dark:text-emerald-400">{brokerSecretNotice}</p>
          ) : null}

          <p className="text-xs text-fg-subtle">{t.brokerSecretEnvOptionalHint}</p>
        </div>
      </div>
      </SettingsFormSection>
    </div>
  );
}

import { Check, ExternalLink, KeyRound, Loader2 } from 'lucide-react';
import { useId, useReducer, type RefObject } from 'react';

import { uiPatchReducer } from '@/lib/settings-form-draft';

import { Button } from '@/components/ui/button';
import { SecretInput } from '@/components/ui/secret-input';
import { SettingsFormSection } from '@/features/settings/settings-form-section';
import { isMaskedKey } from '@/features/settings/providers-api';
import { revealTunnelRegistrationSecret } from '@/features/tunnel/tunnel-api';
import { cn } from '@/lib/cn';
import type { TunnelSettingsMessages } from '@/i18n/messages';

const TUNNEL_CONSOLE_REGISTRATION_KEY_URL = 'https://console.xopc.ai/access/client';

export type BrokerSecretSetupProps = {
  t: TunnelSettingsMessages;
  brokerSecretReady: boolean;
  brokerSecretConfiguredInConfig: boolean;
  brokerSecretMaskedValue: string;
  brokerSecretDraft: string;
  savingBrokerSecret: boolean;
  authorizingBrokerSecret: boolean;
  brokerSecretAuthorizationUrl: string | null;
  brokerSecretNotice: string | null;
  copyFailedLabel: string;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onAuthorize: () => void;
  onClear: () => void;
  sectionRef?: RefObject<HTMLDivElement | null>;
};

type BrokerSecretUi = {
  reconfiguring: boolean;
};

const initialBrokerSecretUi: BrokerSecretUi = {
  reconfiguring: false,
};

export function BrokerSecretSetupSection({
  t,
  brokerSecretReady,
  brokerSecretConfiguredInConfig,
  brokerSecretMaskedValue,
  brokerSecretDraft,
  savingBrokerSecret,
  authorizingBrokerSecret,
  brokerSecretAuthorizationUrl,
  brokerSecretNotice,
  copyFailedLabel,
  onDraftChange,
  onSave,
  onAuthorize,
  onClear,
  sectionRef,
}: BrokerSecretSetupProps) {
  const inputId = useId();
  const ready = brokerSecretReady;
  const needsSetup = !ready;

  const [ui, dispatch] = useReducer(uiPatchReducer<BrokerSecretUi>, initialBrokerSecretUi);
  const { reconfiguring } = ui;

  const showStoredKeyRow =
    brokerSecretConfiguredInConfig && !reconfiguring && !brokerSecretDraft.trim();

  const secretLabels = {
    show: t.showKey,
    hide: t.hideKey,
    copy: t.copyKey,
    copied: t.copied,
  };

  const canSave = brokerSecretDraft.trim().length > 0 && !isMaskedKey(brokerSecretDraft.trim());

  const cancelReconfigure = () => {
    dispatch({ type: 'patch', patch: { reconfiguring: false } });
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

            {needsSetup || reconfiguring ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  disabled={savingBrokerSecret || authorizingBrokerSecret}
                  onClick={onAuthorize}
                >
                  {authorizingBrokerSecret ? <Loader2 className="size-4 animate-spin" /> : null}
                  {authorizingBrokerSecret ? t.brokerSecretAuthorizing : t.brokerSecretAuthorize}
                </Button>
                <a
                  href={TUNNEL_CONSOLE_REGISTRATION_KEY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-fit items-center gap-1 text-xs font-medium text-accent-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {t.brokerSecretConsoleLink}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              </div>
            ) : null}

            {authorizingBrokerSecret && brokerSecretAuthorizationUrl ? (
              <a
                href={brokerSecretAuthorizationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center gap-1 text-xs font-medium text-accent-fg hover:underline"
              >
                {t.brokerSecretOpenAuthorization}
                <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : null}

            {showStoredKeyRow ? (
              <>
                <label className="sr-only" htmlFor={inputId}>
                  {t.brokerSecretTitle}
                </label>
                <SecretInput
                  id={inputId}
                  value={brokerSecretMaskedValue}
                  labels={secretLabels}
                  reveal={() =>
                    revealTunnelRegistrationSecret().then((payload) => payload.registrationSecret ?? null)
                  }
                  loadFailedLabel={copyFailedLabel || t.brokerSecretRevealFailed}
                  maskedHelp={t.brokerSecretMaskedHelp}
                  notInConfigFile={t.brokerSecretNotInConfigFile}
                  readOnly
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={savingBrokerSecret}
                    onClick={() => {
                      dispatch({ type: 'patch', patch: { reconfiguring: true } });
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
                <SecretInput
                  id={inputId}
                  value={brokerSecretDraft}
                  onChange={onDraftChange}
                  placeholder={t.brokerSecretPlaceholder}
                  labels={secretLabels}
                  disabled={savingBrokerSecret}
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" disabled={savingBrokerSecret || !canSave} onClick={onSave}>
                    {savingBrokerSecret ? <Loader2 className="size-4 animate-spin" /> : null}
                    {needsSetup ? t.brokerSecretSaveAndContinue : t.brokerSecretSave}
                  </Button>
                  {brokerSecretConfiguredInConfig ? (
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

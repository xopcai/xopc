import * as Dialog from '@radix-ui/react-dialog';
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { fetchConfiguredModelsCached } from '@/features/chat/registry-api';
import { needsModelOrProviders } from '@/features/gateway/model-setup-state';
import { fetchGatewayConfigSwrResponse } from '@/features/gateway/gateway-config-swr';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

/** Set when the user dismisses the model-setup guide; never show again on this browser profile. */
const LOCAL_STORAGE_MODEL_SETUP_DISMISSED = 'xopc-onboarding-model-setup-dismissed';

type ConfigGet = {
  ok: true;
  payload: {
    config: {
      agents: { defaults: { model: string } };
      providers: Record<string, string>;
    };
  };
};

/**
 * First-visit reminder for model / provider setup (Web and Electron).
 * Non-blocking: user can dismiss; we persist that choice and do not show the guide again.
 */
function OnboardingModelSetupStep() {
  const token = useGatewayStore((s) => s.token);
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).electron;
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const [guideDismissed, setGuideDismissed] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem(LOCAL_STORAGE_MODEL_SETUP_DISMISSED) === '1',
  );
  const [needsSetup, setNeedsSetup] = useState(false);
  const [ready, setReady] = useState(false);

  const onSettingsModelsOrProviders =
    pathname.startsWith('/settings/agent-defaults') ||
    pathname.startsWith('/agents') ||
    pathname.startsWith('/settings/models') ||
    pathname.startsWith('/settings/providers');

  const refresh = useCallback(async () => {
    if (!token) {
      setNeedsSetup(false);
      setReady(true);
      return;
    }
    try {
      const [j, models] = await Promise.all([
        fetchGatewayConfigSwrResponse() as Promise<ConfigGet>,
        fetchConfiguredModelsCached().catch(() => null),
      ]);
      const configNeeds = needsModelOrProviders(j.payload?.config);
      const noUsableModels = Array.isArray(models) && models.length === 0;
      setNeedsSetup(configNeeds || noUsableModels);
    } catch {
      // If config cannot be loaded, still prompt so the user can open model/provider settings.
      setNeedsSetup(true);
    } finally {
      setReady(true);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onReload = () => void refresh();
    window.addEventListener('config-reload', onReload as EventListener);
    return () => window.removeEventListener('config-reload', onReload as EventListener);
  }, [refresh]);

  /** In-memory only for Radix teardown (React Strict Mode); do not write localStorage here. */
  function dismissEphemeral() {
    setGuideDismissed(true);
  }

  /** User chose to close the guide — remember so we do not remind again. */
  function dismissGuidePermanently() {
    try {
      localStorage.setItem(LOCAL_STORAGE_MODEL_SETUP_DISMISSED, '1');
    } catch {
      /* private mode / quota */
    }
    setGuideDismissed(true);
  }

  const open =
    Boolean(token) &&
    ready &&
    needsSetup &&
    !guideDismissed &&
    !onSettingsModelsOrProviders;

  return (
    <Dialog.Root
      modal={false}
      open={open}
      onOpenChange={(next) => {
        // Do not write localStorage here: React 18 Strict Mode remount + Radix can emit
        // onOpenChange(false) on teardown; persisting would hide the dialog for the real mount.
        if (!next && !open) return;
        if (!next) dismissEphemeral();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[100] bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[100] w-[min(100%-2rem,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-panel p-5 shadow-popover',
            'dark:border-edge',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onPointerDownOutside={() => {
            if (onSettingsModelsOrProviders) return;
            dismissGuidePermanently();
          }}
          onEscapeKeyDown={() => dismissGuidePermanently()}
        >
          <Dialog.Title className="text-base font-semibold text-fg">{t.setupBannerTitle}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-relaxed text-fg-muted">{t.setupBannerBody}</Dialog.Description>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              className="sm:min-w-0"
              onClick={() => navigate('/settings/providers')}
            >
              {t.setupBannerLinkProviders}
            </Button>
            <Button
              type="button"
              className="bg-accent text-white hover:bg-accent/90 sm:min-w-0"
              onClick={() => navigate('/agents')}
            >
              {t.setupBannerLinkModels}
            </Button>
            <Button type="button" variant="ghost" className="sm:ml-0" onClick={dismissGuidePermanently}>
              {t.setupBannerDismiss}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Shell onboarding: first-run and follow-up guided flows (e.g. model setup, then starting a new chat).
 * Add new step components here and compose them; persist dismiss flags under `xopc-onboarding-*` (e.g. localStorage).
 */
export function OnboardingDialog() {
  return (
    <>
      <OnboardingModelSetupStep />
    </>
  );
}

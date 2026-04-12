import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { fetchJson } from '@/lib/fetch';
import { isElectron } from '@/lib/electron-env';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

const SESSION_DISMISS_KEY = 'xopc-electron-setup-banner-dismissed-session';

type ConfigGet = {
  ok: true;
  payload: {
    config: {
      agents: { defaults: { model: string } };
      providers: Record<string, string>;
    };
  };
};

function needsModelOrProviders(config: ConfigGet['payload']['config']): boolean {
  const hasProvider = Object.values(config.providers).some((v) => v === '***');
  const modelOk = Boolean(config.agents.defaults.model?.trim());
  return !hasProvider || !modelOk;
}

/** Shown in the Electron shell when no provider key or default model is configured (first launch). */
export function ElectronSetupBanner() {
  const token = useGatewayStore((s) => s.token);
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).electron;

  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (!isElectron() || !token) {
      setVisible(false);
      setReady(true);
      return;
    }
    try {
      const j = await fetchJson<ConfigGet>('/api/config');
      const needs = needsModelOrProviders(j.payload.config);
      const dismissed = sessionStorage.getItem(SESSION_DISMISS_KEY) === '1';
      setVisible(needs && !dismissed);
    } catch {
      setVisible(false);
    } finally {
      setReady(true);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isElectron()) return;
    const onReload = () => void refresh();
    window.addEventListener('config-reload', onReload as EventListener);
    return () => window.removeEventListener('config-reload', onReload as EventListener);
  }, [refresh]);

  function dismiss() {
    sessionStorage.setItem(SESSION_DISMISS_KEY, '1');
    setVisible(false);
  }

  if (!isElectron() || !ready || !visible) return null;

  return (
    <div
      className={cn(
        'shrink-0 border-b border-accent/25 bg-accent-soft px-4 py-3',
        'text-sm text-fg shadow-surface',
      )}
      role="status"
    >
      <div className="mx-auto flex w-full max-w-[min(100%,var(--app-main-max,80rem))] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className="font-semibold text-fg">{t.setupBannerTitle}</p>
          <p className="mt-0.5 text-fg-muted">{t.setupBannerBody}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" className="px-2.5 py-1.5 text-xs" asChild>
            <Link to="/settings/providers">{t.setupBannerLinkProviders}</Link>
          </Button>
          <Button type="button" variant="secondary" className="px-2.5 py-1.5 text-xs" asChild>
            <Link to="/settings/models">{t.setupBannerLinkModels}</Link>
          </Button>
          <Button type="button" variant="ghost" className="px-2.5 py-1.5 text-xs" onClick={dismiss}>
            {t.setupBannerDismiss}
          </Button>
        </div>
      </div>
    </div>
  );
}

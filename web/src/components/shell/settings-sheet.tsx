import { memo, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';

import { resolveSettingsBackTarget } from '@/features/settings/settings-nav-state';
import { cn } from '@/lib/cn';
import { SETTINGS_SHEET_PORTAL_Z } from '@/lib/settings-shell-dialog-layer';
import { SettingsShellLayerProvider } from '@/lib/settings-shell-layer-context';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

interface SettingsSheetProps {
  children: React.ReactNode;
}

const SETTINGS_PORTAL_BODY_MQ = '(max-width: 1199px)';

/**
 * Overlay frame for settings routes: scrim over the main column + floating panel on md+.
 * Escape / scrim navigate to the same target as settings ← Back.
 */
export const SettingsSheet = memo(function SettingsSheet({ children }: SettingsSheetProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const closeTarget = resolveSettingsBackTarget(location.state);

  const [portalToBody, setPortalToBody] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(SETTINGS_PORTAL_BODY_MQ).matches;
  });

  useEffect(() => {
    const mq = window.matchMedia(SETTINGS_PORTAL_BODY_MQ);
    const onChange = () => setPortalToBody(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        navigate(closeTarget);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [navigate, closeTarget]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const scrim = (
    <div
      role="presentation"
      className="absolute inset-0 z-40 bg-scrim/55 backdrop-blur-[2px] dark:bg-black/50"
      onClick={() => navigate(closeTarget)}
    />
  );

  const panel = (
    <div
      className={cn(
        'relative z-50 flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-panel',
        'max-md:shadow-elevated',
        'md:m-3 md:max-h-[calc(100dvh-1.5rem)] md:rounded-2xl md:border md:border-edge md:shadow-elevated',
        'settings-sheet-enter',
      )}
      role="dialog"
      aria-modal="true"
      aria-label={m.nav.settings}
    >
      <SettingsShellLayerProvider layer="page">{children}</SettingsShellLayerProvider>
    </div>
  );

  const shellInner = (
    <>
      {scrim}
      {panel}
    </>
  );

  if (portalToBody) {
    return createPortal(
      <div
        className={cn(
          'fixed inset-0 flex min-h-0 flex-col bg-surface-base',
          SETTINGS_SHEET_PORTAL_Z,
        )}
      >
        {shellInner}
      </div>,
      document.body,
    );
  }

  return (
    <div className="relative flex min-h-0 min-h-[100dvh] flex-1 flex-col md:min-h-0">
      {shellInner}
    </div>
  );
});

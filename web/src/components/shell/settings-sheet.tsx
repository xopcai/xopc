import { memo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { resolveSettingsBackTarget } from '@/features/settings/settings-nav-state';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

interface SettingsSheetProps {
  children: React.ReactNode;
}

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

  return (
    <div className="relative flex min-h-0 min-h-[100dvh] flex-1 flex-col md:min-h-0">
      <div
        role="presentation"
        className="absolute inset-0 z-40 bg-scrim/55 backdrop-blur-[2px] dark:bg-black/50"
        onClick={() => navigate(closeTarget)}
      />
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
        {children}
      </div>
    </div>
  );
});

import * as Dialog from '@radix-ui/react-dialog';
import { memo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';

import { resolveSettingsBackTarget } from '@/features/settings/settings-nav-state';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/use-media-query';
import {
  SETTINGS_SHEET_PORTAL_BODY_MQ,
  SETTINGS_SHEET_PORTAL_Z,
} from '@/lib/settings-shell-dialog-layer';
import { SettingsShellLayerProvider } from '@/lib/settings-shell-layer-context';
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

  const portalToBody = useMediaQuery(SETTINGS_SHEET_PORTAL_BODY_MQ);
  const contentRef = useRef<HTMLDivElement>(null);

  const scrim = (
    <Dialog.Overlay
      className="absolute inset-0 z-40 bg-scrim/55 backdrop-blur-[2px] dark:bg-black/50"
    />
  );

  const panel = (
    <Dialog.Content
      ref={contentRef}
      className={cn(
        'relative z-50 flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-overlay',
        'max-md:shadow-elevated',
        'md:m-3 md:max-h-[calc(100dvh-1.5rem)] md:rounded-2xl md:border md:border-edge md:shadow-elevated',
        'settings-sheet-enter',
      )}
      aria-modal="true"
      aria-label={m.nav.settings}
      aria-describedby={undefined}
      onEscapeKeyDown={(event) => {
        const layers = document.querySelectorAll<HTMLElement>('[data-state="open"]:is([role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"])');
        if (Array.from(layers).some(element => element !== contentRef.current
          && !element.contains(contentRef.current) && element.getClientRects().length > 0)) event.preventDefault();
      }}
    >
      <Dialog.Title className="sr-only">{m.nav.settings}</Dialog.Title>
      <SettingsShellLayerProvider layer="page">{children}</SettingsShellLayerProvider>
    </Dialog.Content>
  );

  const shellInner = (
    <>
      {scrim}
      {panel}
    </>
  );

  const surface = portalToBody ? createPortal(
      <div
        className={cn(
          'fixed inset-0 flex min-h-0 flex-col bg-surface-base',
          SETTINGS_SHEET_PORTAL_Z,
        )}
      >
        {shellInner}
      </div>,
      document.body,
    ) : (
    <div className="relative flex min-h-0 min-h-[100dvh] flex-1 flex-col md:min-h-0">
      {shellInner}
    </div>
  );
  return <Dialog.Root open onOpenChange={(open) => { if (!open) navigate(closeTarget); }}>{surface}</Dialog.Root>;
});

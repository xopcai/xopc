import * as Dialog from '@radix-ui/react-dialog';
import { useLocation, useNavigate } from 'react-router-dom';

import { OnboardingCard } from '@/features/onboarding/onboarding-card';
import { fetchWorkDiscoveryOnboarding } from '@/features/work-discovery/api';
import { useNeedsModelSetup } from '@/features/onboarding/use-needs-model-setup';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

/**
 * First-run model / provider setup: modal so it appears regardless of chat route or session loading.
 * Chat page may still mount {@link OnboardingCard} only when the welcome overlay is shown; this shell
 * layer is the reliable entry point.
 */
export function OnboardingDialog() {
  const token = useGatewayStore((s) => s.token);
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const modelSetup = useNeedsModelSetup(Boolean(token));
  const isSettingsRoute = pathname.startsWith('/settings');

  const open =
    Boolean(token) &&
    !isSettingsRoute &&
    modelSetup.ready &&
    modelSetup.needsSetup &&
    !modelSetup.guideDismissed;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          modelSetup.dismissPermanently();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[55] bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[56] max-h-[min(100dvh-2rem,44rem)] w-[min(100%-2rem,36rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto',
            'rounded-xl p-2 outline-none sm:p-3',
          )}
          onPointerDownOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Dialog.Title className="sr-only">{m.onboarding.title}</Dialog.Title>
          <Dialog.Description className="sr-only">{m.onboarding.subtitle}</Dialog.Description>
          <OnboardingCard
            onComplete={async () => {
              await modelSetup.refresh();
              const workDiscovery = await fetchWorkDiscoveryOnboarding().catch(() => null);
              navigate(workDiscovery?.enabled ? '/onboarding/workspace' : '/chat');
            }}
            onDismiss={modelSetup.dismissPermanently}
            canDismiss
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

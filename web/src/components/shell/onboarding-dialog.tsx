import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { OnboardingCard } from '@/features/onboarding/onboarding-card';
import {
  deriveOnboardingExperienceState,
  hasPendingWorkDiscovery,
} from '@/features/onboarding/onboarding-experience-state';
import {
  dismissWorkDiscoveryOnboarding,
  fetchWorkDiscoveryOnboarding,
  type WorkDiscoveryOnboardingSnapshot,
} from '@/features/work-discovery/api';
import { WorkDiscoveryPage } from '@/features/work-discovery/work-discovery-page';
import { useNeedsModelSetup } from '@/features/onboarding/use-needs-model-setup';
import { messages } from '@/i18n/messages';
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
  const [workDiscovery, setWorkDiscovery] = useState<WorkDiscoveryOnboardingSnapshot | null>(null);
  const [experienceClosed, setExperienceClosed] = useState(false);

  useEffect(() => {
    setExperienceClosed(false);
    if (!token) {
      setWorkDiscovery(null);
      return;
    }
    let cancelled = false;
    void fetchWorkDiscoveryOnboarding()
      .then((snapshot) => {
        if (!cancelled) setWorkDiscovery(snapshot);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token]);

  const experience = deriveOnboardingExperienceState({
    authenticated: Boolean(token),
    settingsRoute: isSettingsRoute,
    modelSetupReady: modelSetup.ready,
    needsModelSetup: modelSetup.needsSetup,
    modelGuideDismissed: modelSetup.guideDismissed,
    workDiscovery,
    closed: experienceClosed,
  });

  const closeExperience = () => {
    setExperienceClosed(true);
  };

  const leaveExperience = () => {
    closeExperience();
    navigate('/chat');
  };

  const dismissExperience = () => {
    closeExperience();
    modelSetup.dismissPermanently();
    void dismissWorkDiscoveryOnboarding().catch(() => {});
  };

  return (
    <Dialog.Root
      open={experience.open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          if (experience.stage === 'setup') dismissExperience();
          else leaveExperience();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[55] bg-scrim backdrop-blur-md" />
        <Dialog.Content
          className="xopc-onboarding-dialog fixed inset-0 z-[56] overflow-hidden bg-surface-base outline-none"
          onPointerDownOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Dialog.Title className="sr-only">{m.onboarding.title}</Dialog.Title>
          <Dialog.Description className="sr-only">{m.onboarding.subtitle}</Dialog.Description>
          {experience.stage === 'setup' ? (
            <OnboardingCard
              onComplete={async () => {
                const workDiscovery = await fetchWorkDiscoveryOnboarding().catch(() => null);
                setWorkDiscovery(workDiscovery);
                await modelSetup.refresh();
                if (!hasPendingWorkDiscovery(workDiscovery)) leaveExperience();
              }}
              onDismiss={dismissExperience}
              canDismiss
            />
          ) : (
            <div className="xopc-onboarding-work-stage h-full overflow-hidden">
              <WorkDiscoveryPage
                embedded
                onRequestClose={leaveExperience}
                onNavigateAway={closeExperience}
              />
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

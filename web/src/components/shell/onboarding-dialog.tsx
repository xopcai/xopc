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
import { CloudOnboardingCard, useCloudOnboarding } from '@/features/onboarding/cloud-onboarding';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { isElectron } from '@/lib/electron-env';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

/** First-run model setup and work-understanding flow, mounted above every authenticated route. */
export function OnboardingDialog() {
  const token = useGatewayStore((s) => s.conversationId);
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const modelSetup = useNeedsModelSetup(Boolean(token));
  const cloudOnboarding = useCloudOnboarding(Boolean(token));
  const isSettingsRoute = pathname.startsWith('/settings') || pathname === '/personal';
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
    desktop: isElectron(),
    settingsRoute: isSettingsRoute,
    modelSetupReady: modelSetup.ready,
    needsModelSetup: modelSetup.needsSetup,
    modelGuideDismissed: modelSetup.guideDismissed,
    cloudOnboardingReady: cloudOnboarding.ready,
    cloudOnboardingPending: cloudOnboarding.pending,
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

  const dismissCloud = async () => {
    await cloudOnboarding.dismiss();
    if (modelSetup.ready && !modelSetup.needsSetup && !hasPendingWorkDiscovery(workDiscovery)) closeExperience();
  };

  return (
    <Dialog.Root
      modal={experience.stage !== 'cloud'}
      open={experience.open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          if (experience.stage === 'setup') dismissExperience();
          else if (experience.stage === 'cloud') void dismissCloud().catch(closeExperience);
          else leaveExperience();
        }
      }}
    >
      <Dialog.Portal>
        {experience.stage !== 'cloud' ? <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[55] bg-scrim backdrop-blur-md" /> : null}
        <Dialog.Content
          className={cn(
            'app-chrome-shell fixed z-[56] outline-none',
            experience.stage === 'cloud'
              ? 'bottom-4 right-4 max-h-[calc(100vh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-edge bg-surface-panel shadow-xl'
              : 'xopc-onboarding-dialog inset-0 overflow-hidden',
          )}
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
                const cloudStatus = await cloudOnboarding.refresh().catch(() => null);
                let cloudPromptPending = cloudStatus?.status === 'unseen' && !cloudStatus.hasGrant;
                if (isElectron() && cloudPromptPending) {
                  // The desktop setup wizard already presented XOPC Cloud as its recommended provider.
                  await cloudOnboarding.dismiss().catch(() => undefined);
                  cloudPromptPending = false;
                }
                if (!hasPendingWorkDiscovery(workDiscovery) && !cloudPromptPending) leaveExperience();
              }}
              onDismiss={dismissExperience}
              canDismiss
            />
          ) : experience.stage === 'cloud' ? (
            <CloudOnboardingCard
              context={pathname.startsWith('/chat') ? 'chat' : pathname === '/personal' ? 'personal' : 'general'}
              onDismiss={() => void dismissCloud().catch(closeExperience)}
              onConnected={() => {
                void cloudOnboarding.refresh().catch(closeExperience);
              }}
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

import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { OnboardingCard } from '@/features/onboarding/onboarding-card';
import { fetchWorkDiscoveryOnboarding } from '@/features/work-discovery/api';
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
  const [experienceStage, setExperienceStage] = useState<'setup' | 'work'>('setup');
  const [activationOpen, setActivationOpen] = useState(false);

  const open =
    Boolean(token) &&
    !isSettingsRoute &&
    modelSetup.ready &&
    ((modelSetup.needsSetup && !modelSetup.guideDismissed) || activationOpen);

  const closeExperience = () => {
    setActivationOpen(false);
  };

  const leaveExperience = () => {
    closeExperience();
    navigate('/chat');
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          if (experienceStage === 'setup') modelSetup.dismissPermanently();
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
          {experienceStage === 'setup' ? (
            <OnboardingCard
              onComplete={async () => {
                const workDiscovery = await fetchWorkDiscoveryOnboarding().catch(() => null);
                if (workDiscovery?.enabled) {
                  setExperienceStage('work');
                  setActivationOpen(true);
                }
                await modelSetup.refresh();
                if (!workDiscovery?.enabled) navigate('/chat');
              }}
              onDismiss={modelSetup.dismissPermanently}
              canDismiss
            />
          ) : (
            <div className="xopc-onboarding-work-stage h-full overflow-hidden">
              <WorkDiscoveryPage
                embedded
                onRequestClose={leaveExperience}
                onConversationOpen={closeExperience}
              />
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

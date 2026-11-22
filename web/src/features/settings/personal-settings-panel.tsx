import { useState } from 'react';

import { PersonalConversationResetSetting } from '@/features/personal-agent/personal-conversation-reset-setting';
import { usePersonalProfile } from '@/features/personal-agent/use-personal-profile';
import { PersonalProactivitySetting } from '@/features/personal-agent/personal-proactivity-setting';
import { PersonalProfileSettings } from '@/features/personal-agent/personal-profile-settings';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import { useLocaleStore } from '@/stores/locale-store';
import { VoiceSettingsPanel } from './voice-settings';

export function PersonalSettingsPanel() {
  const { profile, displayName } = usePersonalProfile();
  const zh = useLocaleStore(state => state.language) === 'zh';
  const [servicesOpen, setServicesOpen] = useState(false);
  const [servicesMounted, setServicesMounted] = useState(false);
  const openVoiceServices = () => { setServicesOpen(true); setServicesMounted(true); };
  return <SettingsPageFrame>
    <SettingsPageHeader title={displayName} />
    <PersonalProfileSettings zh={zh} onOpenVoiceServices={openVoiceServices} showMessageReactions />
    <PersonalProactivitySetting zh={zh} />
    <details className="rounded-xl border border-edge p-4" open={servicesOpen} onToggle={event => {
      setServicesOpen(event.currentTarget.open);
      if (event.currentTarget.open) setServicesMounted(true);
    }}>
      <summary className="cursor-pointer text-sm font-medium text-fg">{zh ? '语音服务设置' : 'Voice service settings'}</summary>
      <div className="mt-4">{servicesMounted && <VoiceSettingsPanel capability="conversation" />}</div>
    </details>
    <PersonalConversationResetSetting zh={zh} displayName={displayName} profile={profile} />
  </SettingsPageFrame>;
}

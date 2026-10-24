import { usePersonalProfile } from '@/features/personal-agent/use-personal-profile';
import { PersonalProactivitySetting } from '@/features/personal-agent/personal-proactivity-setting';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import { useLocaleStore } from '@/stores/locale-store';

export function PersonalSettingsPanel() {
  const { displayName } = usePersonalProfile();
  const zh = useLocaleStore(state => state.language) === 'zh';
  return <SettingsPageFrame>
    <SettingsPageHeader title={displayName} subtitle={zh
      ? `设置 ${displayName} 主动联系你的方式和免打扰时段。`
      : `Manage proactive messages from ${displayName} and quiet hours.`} />
    <PersonalProactivitySetting zh={zh} />
  </SettingsPageFrame>;
}

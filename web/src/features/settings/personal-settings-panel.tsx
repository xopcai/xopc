import { PersonalProactivitySetting } from '@/features/personal-agent/personal-proactivity-setting';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import { useLocaleStore } from '@/stores/locale-store';

export function PersonalSettingsPanel() {
  const zh = useLocaleStore(state => state.language) === 'zh';
  return <SettingsPageFrame>
    <SettingsPageHeader title="Personal AI" subtitle={zh
      ? '管理主动联系和静默时段。'
      : 'Manage proactive messages and quiet hours.'} />
    <PersonalProactivitySetting zh={zh} />
  </SettingsPageFrame>;
}

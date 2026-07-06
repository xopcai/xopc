/**
 * Inline appearance preferences — language and theme on the settings home screen.
 */
import { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import {
  type Language,
  type ThemePreference,
  usePreferencesStore,
} from '../../stores/preferences-store';

import {
  SettingsOptionRow,
  SettingsSection,
  useSettingsColors,
} from './settings-ui';

const LANGUAGE_OPTIONS: { value: Language; labelKey: 'languageEn' | 'languageZh' }[] = [
  { value: 'en', labelKey: 'languageEn' },
  { value: 'zh', labelKey: 'languageZh' },
];

const THEME_OPTIONS: { value: ThemePreference; labelKey: 'themeLight' | 'themeDark' | 'themeSystem' }[] = [
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
  { value: 'system', labelKey: 'themeSystem' },
];

export const AppearanceSection = memo(function AppearanceSection() {
  const m = useMessages();
  const s = m.settings;
  const colors = useSettingsColors();

  const language = usePreferencesStore((st) => st.language);
  const themePreference = usePreferencesStore((st) => st.themePreference);
  const setLanguage = usePreferencesStore((st) => st.setLanguage);
  const setThemePreference = usePreferencesStore((st) => st.setThemePreference);

  const handleLanguageChange = useCallback(
    (value: Language) => setLanguage(value),
    [setLanguage],
  );

  const handleThemeChange = useCallback(
    (value: ThemePreference) => setThemePreference(value),
    [setThemePreference],
  );

  return (
    <SettingsSection title={s.sectionPreferences}>
      <Text style={[styles.groupLabel, { color: colors.textMuted }]}>{s.language}</Text>
      {LANGUAGE_OPTIONS.map((opt, i) => (
        <SettingsOptionRow
          key={opt.value}
          label={s[opt.labelKey]}
          selected={language === opt.value}
          isLast={i === LANGUAGE_OPTIONS.length - 1}
          onPress={() => handleLanguageChange(opt.value)}
        />
      ))}

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <Text style={[styles.groupLabel, { color: colors.textMuted }]}>{s.theme}</Text>
      {THEME_OPTIONS.map((opt, i) => (
        <SettingsOptionRow
          key={opt.value}
          label={s[opt.labelKey]}
          selected={themePreference === opt.value}
          isLast={i === THEME_OPTIONS.length - 1}
          onPress={() => handleThemeChange(opt.value)}
        />
      ))}
    </SettingsSection>
  );
});

const styles = StyleSheet.create({
  groupLabel: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 4,
    marginBottom: 2,
    marginLeft: 16,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
    marginHorizontal: 16,
  },
});

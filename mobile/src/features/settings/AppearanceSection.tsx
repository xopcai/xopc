/**
 * Appearance settings section — language + theme preference.
 *
 * Uses SegmentedButtons for theme (Light / Dark / System)
 * and a simple toggle for language (EN / 中文).
 */
import { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Divider, SegmentedButtons, Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import {
  type Language,
  type ThemePreference,
  usePreferencesStore,
} from '../../stores/preferences-store';

const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
];

const THEME_OPTIONS: { value: ThemePreference; labelKey: 'themeLight' | 'themeDark' | 'themeSystem' }[] = [
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
  { value: 'system', labelKey: 'themeSystem' },
];

export const AppearanceSection = memo(function AppearanceSection() {
  const m = useMessages();
  const s = m.settings;

  const language = usePreferencesStore((st) => st.language);
  const themePreference = usePreferencesStore((st) => st.themePreference);
  const setLanguage = usePreferencesStore((st) => st.setLanguage);
  const setThemePreference = usePreferencesStore((st) => st.setThemePreference);

  const handleLanguageChange = useCallback(
    (value: string) => setLanguage(value as Language),
    [setLanguage],
  );

  const handleThemeChange = useCallback(
    (value: string) => setThemePreference(value as ThemePreference),
    [setThemePreference],
  );

  return (
    <View style={styles.section}>
      <Text variant="titleMedium" style={styles.heading}>
        {s.appearance}
      </Text>

      {/* Language */}
      <Text variant="labelMedium" style={styles.label}>
        {s.language}
      </Text>
      <SegmentedButtons
        value={language}
        onValueChange={handleLanguageChange}
        buttons={LANGUAGE_OPTIONS.map((o) => ({
          value: o.value,
          label: o.label,
        }))}
        style={styles.segmented}
      />

      <Divider style={styles.divider} />

      {/* Theme */}
      <Text variant="labelMedium" style={styles.label}>
        {s.theme}
      </Text>
      <SegmentedButtons
        value={themePreference}
        onValueChange={handleThemeChange}
        buttons={THEME_OPTIONS.map((o) => ({
          value: o.value,
          label: s[o.labelKey],
        }))}
        style={styles.segmented}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  section: {
    marginTop: 24,
  },
  heading: {
    marginBottom: 12,
  },
  label: {
    marginBottom: 8,
    opacity: 0.7,
  },
  segmented: {
    marginBottom: 4,
  },
  divider: {
    marginVertical: 16,
  },
});

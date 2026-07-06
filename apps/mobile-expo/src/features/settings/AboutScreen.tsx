import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { FloatingHeader } from '@/components/FloatingHeader';
import { useMessages } from '@/i18n/messages';

import { SettingsRow, SettingsSection, useSettingsColors } from './settings-ui';

export function AboutScreen() {
  const router = useRouter();
  const m = useMessages();
  const s = m.settings;
  const colors = useSettingsColors();
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <View style={{ flex: 1, backgroundColor: colors.pageBg }}>
      <FloatingHeader title={s.about} onBack={() => router.back()} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
      >
      <View style={styles.hero}>
        <Text style={[styles.appName, { color: colors.text }]}>XOPC</Text>
        <Text style={[styles.version, { color: colors.textMuted }]}>v{appVersion}</Text>
        <Text style={[styles.tagline, { color: colors.textMuted }]}>{s.aboutDescription}</Text>
      </View>

      <SettingsSection>
        <SettingsRow
          icon="book-open-variant"
          iconColor={colors.accent}
          label={s.helpDocs}
          onPress={() => void Linking.openURL('https://xopcai.github.io/xopc')}
        />
        <SettingsRow
          icon="github"
          iconColor={colors.text}
          label={s.sourceCode}
          isLast
          onPress={() => void Linking.openURL('https://github.com/xopcai/xopc')}
        />
      </SettingsSection>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 32,
  },
  hero: {
    alignItems: 'center',
    marginBottom: 28,
    gap: 6,
  },
  appName: {
    fontSize: 28,
    fontWeight: '700',
  },
  version: {
    fontSize: 15,
  },
  tagline: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 8,
    paddingHorizontal: 24,
  },
});

import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Switch } from 'react-native-paper';

import { NativeScreenHeader } from '@/components/NativeScreenHeader';
import { useMessages } from '@/i18n/messages';
import { dismissOrHome, useDismissOnHardwareBack } from '@/lib/navigation';
import { useGatewayConfigured } from '@/query/sessions';
import { useGatewayStore } from '@/stores/gateway-store';
import { gatewayProfileHost } from '@/stores/gateway-types';
import { usePreferencesStore } from '@/stores/preferences-store';
import {
  disableMobileNotifications,
  enableMobileNotifications,
} from '@/features/notifications/mobile-notifications';

import { AppearanceSection } from './AppearanceSection';
import {
  SettingsRow,
  SettingsSection,
  useSettingsColors,
} from './settings-ui';

export function SettingsScreen() {
  const router = useRouter();
  const m = useMessages();
  const s = m.settings;
  const colors = useSettingsColors();
  const clipboardIntakeEnabled = usePreferencesStore((st) => st.clipboardIntakeEnabled);
  const setClipboardIntakeEnabled = usePreferencesStore((st) => st.setClipboardIntakeEnabled);
  const notificationsEnabled = usePreferencesStore((st) => st.notificationsEnabled);
  const setNotificationsEnabled = usePreferencesStore((st) => st.setNotificationsEnabled);
  const [notificationsUpdating, setNotificationsUpdating] = useState(false);

  const configured = useGatewayConfigured();
  const profiles = useGatewayStore((st) => st.profiles);
  const activeProfile = useGatewayStore((st) =>
    st.activeGatewayId ? st.profiles.find((p) => p.gatewayId === st.activeGatewayId) : null,
  );
  const gatewayValue = useMemo(() => {
    if (!configured || !activeProfile) return s.gatewayNotConfigured;
    const host = gatewayProfileHost(activeProfile);
    return profiles.length > 1 ? `${activeProfile.name} · ${host}` : host;
  }, [
    activeProfile,
    configured,
    profiles.length,
    s.gatewayNotConfigured,
  ]);

  useDismissOnHardwareBack(router);
  const toggleNotifications = useCallback(async (next: boolean) => {
    if (notificationsUpdating) return;
    setNotificationsEnabled(next);
    setNotificationsUpdating(true);
    try {
      if (next) {
        const result = await enableMobileNotifications();
        if (!result.ok) {
          const retryable = result.reason === 'gateway-registration-failed';
          if (!retryable) setNotificationsEnabled(false);
          Alert.alert(
            s.notifications,
            result.reason === 'permission-denied'
              ? s.notificationsPermissionDenied
              : retryable
                ? s.notificationsRegistrationFailed
                : s.notificationsUnavailable,
          );
        }
      } else {
        await disableMobileNotifications();
      }
    } finally {
      setNotificationsUpdating(false);
    }
  }, [notificationsUpdating, s, setNotificationsEnabled]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.pageBg }}>
      <NativeScreenHeader title={s.title} onBack={() => dismissOrHome(router)} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <SettingsSection title={s.sectionConnection}>
          <SettingsRow
            icon="web"
            iconColor={colors.accent}
            label={s.gateway}
            value={gatewayValue}
            isLast={!configured}
            onPress={() => router.push('/settings/gateway')}
          />
          {configured ? (
            <SettingsRow
              icon="bell-outline"
              iconColor={colors.accent}
              label={s.notifications}
              value={s.notificationsHint}
              showChevron={false}
              rightAccessory={(
                <Switch
                  value={notificationsEnabled}
                  disabled={notificationsUpdating}
                  onValueChange={(value) => void toggleNotifications(value)}
                />
              )}
            />
          ) : null}
        </SettingsSection>

        <SettingsSection title={s.sectionPreferences}>
          <SettingsRow
            icon="clipboard-text-outline"
            iconColor={colors.accent}
            label={s.clipboardIntake}
            showChevron={false}
            rightAccessory={(
              <Switch
                value={clipboardIntakeEnabled}
                onValueChange={setClipboardIntakeEnabled}
              />
            )}
          />
        </SettingsSection>

        {configured ? (
          <>
            <SettingsSection title={s.sectionAi}>
              <SettingsRow
                icon="robot-outline"
                iconColor={colors.accent}
                label={m.agentsPage.title}
                isLast
                onPress={() => router.push('/ai/agents')}
              />
            </SettingsSection>

            <SettingsSection title={s.sectionAutomation}>
              <SettingsRow
                icon="clock-outline"
                iconColor={colors.warning}
                label={m.automationPage.title}
                isLast
                onPress={() => router.push('/automation')}
              />
            </SettingsSection>

            <SettingsSection title={s.sectionSharing}>
              <SettingsRow
                icon="share-variant"
                iconColor={colors.accent}
                label={m.sharingPage.title}
                isLast
                onPress={() => router.push('/sharing')}
              />
            </SettingsSection>
          </>
        ) : null}

        <AppearanceSection />

        <SettingsSection title={s.sectionAbout}>
          <SettingsRow
            icon="information-outline"
            iconColor={colors.textMuted}
            label={s.about}
            isLast
            onPress={() => router.push('/settings/about')}
          />
        </SettingsSection>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 40,
  },
  bottomSpacer: {
    height: 24,
  },
});

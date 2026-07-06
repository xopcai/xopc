import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Switch } from 'react-native-paper';

import { FloatingHeader } from '@/components/FloatingHeader';
import {
  connectionKindLabel,
  useGatewayConnectionView,
} from '@/features/gateway/use-gateway-connection-view';
import { useMessages } from '@/i18n/messages';
import { dismissOrHome, useDismissOnHardwareBack } from '@/lib/navigation';
import { useGatewayConfigured } from '@/query/sessions';
import { useGatewayStore } from '@/stores/gateway-store';
import { usePreferencesStore } from '@/stores/preferences-store';

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

  const configured = useGatewayConfigured();
  const connectionView = useGatewayConnectionView();
  const profiles = useGatewayStore((st) => st.profiles);
  const activeProfile = useGatewayStore((st) =>
    st.activeGatewayId ? st.profiles.find((p) => p.id === st.activeGatewayId) : null,
  );
  const mGateway = m.gateway;
  const gatewayValue = useMemo(() => {
    if (!configured || connectionView.connectionKind === 'unconfigured') {
      return s.gatewayNotConfigured;
    }
    const host = connectionView.activeHost || connectionView.tunnelHost;
    const kind = connectionKindLabel(connectionView.connectionKind, mGateway);
    const hostPart = host ? `${host} · ${kind}` : kind;
    if (profiles.length > 1 && activeProfile?.name) {
      return `${activeProfile.name} · ${hostPart}`;
    }
    return hostPart;
  }, [
    activeProfile?.name,
    configured,
    connectionView,
    mGateway,
    profiles.length,
    s.gatewayNotConfigured,
  ]);

  useDismissOnHardwareBack(router);
  return (
    <View style={{ flex: 1, backgroundColor: colors.pageBg }}>
      <FloatingHeader title={s.title} onBack={() => dismissOrHome(router)} />
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
            isLast
            onPress={() => router.push('/settings/gateway')}
          />
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
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
  },
  bottomSpacer: {
    height: 24,
  },
});

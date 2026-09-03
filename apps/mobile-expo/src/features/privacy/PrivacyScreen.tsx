import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import { Button, IconButton, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { useMessages } from '../../i18n/messages';
import { useGatewayStore } from '../../stores/gateway-store';
import { spacing, useTheme } from '../../theme';
import { dataSharingConsent, revokeDataSharingConsent } from './data-sharing-consent';

export function PrivacyScreen({ onClose }: { onClose?: () => void } = {}) {
  const router = useRouter();
  const messages = useMessages();
  const m = messages.privacy;
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const gatewayId = useGatewayStore((state) => state.activeGatewayId);
  const [busy, setBusy] = useState(false);
  const sections = [
    [m.overviewTitle, m.overview],
    [m.deviceTitle, m.device],
    [m.permissionsTitle, m.permissions],
    [m.notificationsTitle, m.notifications],
    [m.deletionTitle, m.deletion],
  ];
  const review = async () => {
    setBusy(true);
    try { await dataSharingConsent.ensure(true); }
    catch (error) { Alert.alert(m.title, error instanceof Error ? error.message : m.consentRequired); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.base }}>
      {onClose ? (
        <View style={{ paddingTop: insets.top, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center' }}>
          <IconButton icon="arrow-left" onPress={onClose} accessibilityLabel={messages.common.back} />
          <Text variant="titleMedium" accessibilityRole="header" style={{ flex: 1 }}>{m.title}</Text>
        </View>
      ) : <NativeScreenHeader title={m.title} onBack={() => router.back()} />}
      <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.xl, paddingBottom: spacing.xxxl + insets.bottom }}>
        {sections.map(([title, content]) => (
          <View key={title} style={{ gap: spacing.sm }}>
            <Text variant="titleMedium" accessibilityRole="header">{title}</Text>
            <Text variant="bodyMedium">{content}</Text>
          </View>
        ))}
        {gatewayId ? (
          <View style={{ gap: spacing.sm }}>
            <Button mode="contained" loading={busy} disabled={busy} onPress={() => void review()}>{m.review}</Button>
            <Button disabled={busy} onPress={() => {
              revokeDataSharingConsent();
              Alert.alert(m.revoked, m.revocationNotice);
            }}>{m.revoke}</Button>
          </View>
        ) : <Text>{m.noGateway}</Text>}
        <Button onPress={() => void Linking.openURL('https://github.com/xopcai/xopc/issues')}>{m.support}</Button>
      </ScrollView>
    </View>
  );
}

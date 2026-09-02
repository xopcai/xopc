import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Icon, Text } from 'react-native-paper';

import { NativeScreenHeader } from '@/components/NativeScreenHeader';
import { SettingsSection, useSettingsColors } from '@/features/settings/settings-ui';
import { useMessages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { gatewayProfileHost } from '@/stores/gateway-types';

import { switchGatewayProfile } from './gateway-switch-service';

export function GatewayListScreen() {
  const router = useRouter();
  const m = useMessages();
  const colors = useSettingsColors();
  const profiles = useGatewayStore((state) => state.profiles);
  const activeGatewayId = useGatewayStore((state) => state.activeGatewayId);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const switchProfile = useCallback((gatewayId: string) => {
    if (gatewayId === useGatewayStore.getState().activeGatewayId) return;
    setSwitchingId(gatewayId);
    setError('');
    void switchGatewayProfile(gatewayId)
      .then((result) => {
        if (result.status === 'failed') setError(result.error.message);
      })
      .finally(() => setSwitchingId(null));
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.pageBg }}>
      <NativeScreenHeader
        title={m.settings.gateway}
        onBack={() => router.back()}
        rightActions={[{ icon: 'plus', onPress: () => router.push('/settings/gateway/new'), accessibilityLabel: m.settings.addGateway }]}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="bodySmall" style={{ color: colors.textMuted }}>{m.settings.gatewayHint}</Text>
        {profiles.length === 0 ? (
          <Text style={{ color: colors.textMuted }}>{m.settings.gatewaysEmpty}</Text>
        ) : (
          <SettingsSection>
            {profiles.map((profile, index) => {
              const active = profile.gatewayId === activeGatewayId;
              return (
                <View key={profile.gatewayId} style={[styles.row, index > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
                  <Pressable style={styles.main} onPress={() => switchProfile(profile.gatewayId)}>
                    <View style={styles.text}>
                      <Text variant="titleSmall">{profile.name}</Text>
                      <Text variant="bodySmall" style={{ color: colors.textMuted }}>{gatewayProfileHost(profile)}</Text>
                    </View>
                    {switchingId === profile.gatewayId ? <ActivityIndicator size={18} /> : active ? <Icon source="check" size={20} color={colors.accent} /> : null}
                  </Pressable>
                  <Pressable style={styles.edit} onPress={() => router.push(`/settings/gateway/${profile.gatewayId}`)}>
                    <Icon source="chevron-right" size={20} color={colors.textMuted} />
                  </Pressable>
                </View>
              );
            })}
          </SettingsSection>
        )}
        {error ? <Text style={{ color: colors.error }}>{error}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 16 },
  row: { minHeight: 62, flexDirection: 'row', alignItems: 'center' },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 14 },
  text: { flex: 1, gap: 2 },
  edit: { padding: 14 },
});

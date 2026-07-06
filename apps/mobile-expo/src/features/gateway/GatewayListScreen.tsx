import { useFocusEffect } from 'expo-router';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text } from 'react-native-paper';

import { FloatingHeader } from '@/components/FloatingHeader';
import {
  SettingsSection,
  useSettingsColors,
} from '@/features/settings/settings-ui';
import { useMessages } from '@/i18n/messages';
import { useGatewayConfigured } from '@/query/sessions';
import { useGatewayStore } from '@/stores/gateway-store';
import type { GatewayProfile } from '@/stores/gateway-types';

import { syncGatewayUrlsFromTunnelQr } from './apply-tunnel-qr-from-api';
import { ConnectionLogCard } from './ConnectionLogCard';
import { GatewayConnectionCard } from './GatewayConnectionCard';
import { formatGatewayHost } from './gateway-connection-view';
import { syncAfterGatewaySettingsSave } from './gateway-connection-sync';
import { GatewayTunnelStatusCard } from './GatewayTunnelStatusCard';
import { openDefaultSessionAfterConnect } from './navigate-after-gateway-connect';
import {
  connectionKindLabel,
  useGatewayConnectionView,
} from './use-gateway-connection-view';

function profileSubtitle(
  profile: GatewayProfile,
  isActive: boolean,
  connectionView: ReturnType<typeof useGatewayConnectionView>,
  g: ReturnType<typeof useMessages>['gateway'],
): string {
  const host = formatGatewayHost(profile.baseUrl);
  if (!isActive) return host;
  if (connectionView.connectionKind === 'unconfigured') return host;
  const kind = connectionKindLabel(connectionView.connectionKind, g);
  const activeHost = connectionView.activeHost || host;
  return `${activeHost} · ${kind}`;
}

export function GatewayListScreen() {
  const router = useRouter();
  const m = useMessages();
  const s = m.settings;
  const g = m.gateway;
  const colors = useSettingsColors();

  const profiles = useGatewayStore((st) => st.profiles);
  const activeGatewayId = useGatewayStore((st) => st.activeGatewayId);
  const switchGateway = useGatewayStore((st) => st.switchGateway);
  const configured = useGatewayConfigured();
  const connectionView = useGatewayConnectionView();

  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [tunnelStatusRefreshToken, setTunnelStatusRefreshToken] = useState(0);

  useFocusEffect(
    useCallback(() => {
      const tunnel = useGatewayStore.getState().baseUrl.trim();
      if (tunnel) void syncGatewayUrlsFromTunnelQr();
      setTunnelStatusRefreshToken((n) => n + 1);
    }, []),
  );

  const handleSwitch = useCallback(
    async (id: string) => {
      if (id === activeGatewayId || switchingId) return;
      setSwitchingId(id);
      try {
        switchGateway(id);
        await syncAfterGatewaySettingsSave();
        await openDefaultSessionAfterConnect(router.replace);
      } finally {
        setSwitchingId(null);
      }
    },
    [activeGatewayId, router, switchGateway, switchingId],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.pageBg }}>
      <FloatingHeader title={s.gateway} onBack={() => router.back()} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
      <Text variant="bodySmall" style={[styles.hint, { color: colors.textMuted }]}>
        {s.gatewayHint}
      </Text>

      {profiles.length === 0 ? (
        <Text variant="bodyMedium" style={[styles.empty, { color: colors.textMuted }]}>
          {s.gatewaysEmpty}
        </Text>
      ) : (
        <SettingsSection>
          {profiles.map((profile, index) => {
            const isActive = profile.id === activeGatewayId;
            const isSwitching = switchingId === profile.id;
            return (
              <View
                key={profile.id}
                style={[
                  styles.rowWrap,
                  index < profiles.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                <Pressable
                  onPress={() => {
                    if (!isActive) void handleSwitch(profile.id);
                  }}
                  disabled={isSwitching}
                  style={({ pressed }) => [
                    styles.rowMain,
                    pressed && !isActive && styles.rowPressed,
                  ]}
                >
                  <View style={styles.rowText}>
                    <Text style={[styles.rowLabel, { color: colors.text }]} numberOfLines={1}>
                      {profile.name}
                    </Text>
                    <Text style={[styles.rowDescription, { color: colors.textMuted }]} numberOfLines={2}>
                      {profileSubtitle(profile, isActive, connectionView, g)}
                    </Text>
                  </View>
                  {isSwitching ? (
                    <ActivityIndicator size={20} />
                  ) : isActive ? (
                    <Icon source="check" size={20} color={colors.accent} />
                  ) : null}
                </Pressable>
                <Pressable
                  onPress={() => router.push(`/settings/gateway/${profile.id}`)}
                  style={({ pressed }) => [styles.editBtn, pressed && styles.rowPressed]}
                  accessibilityLabel={s.editGateway}
                >
                  <Icon source="chevron-right" size={20} color={colors.textMuted} />
                </Pressable>
              </View>
            );
          })}
        </SettingsSection>
      )}

      <View style={styles.addRow}>
        <Button mode="contained" icon="plus" onPress={() => router.push('/settings/gateway/new')}>
          {s.addGateway}
        </Button>
      </View>

      {configured ? (
        <>
          <GatewayConnectionCard
            onSyncNotice={(message) => setSyncNotice(message)}
          />
          <GatewayTunnelStatusCard refreshToken={tunnelStatusRefreshToken} />
          <ConnectionLogCard />
        </>
      ) : null}

      {syncNotice ? (
        <Text variant="bodySmall" style={[styles.syncNotice, { color: colors.textMuted }]}>
          {syncNotice}
        </Text>
      ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: 16,
    paddingBottom: 32,
  },
  hint: {
    marginBottom: 16,
    lineHeight: 20,
  },
  empty: {
    marginBottom: 16,
    lineHeight: 22,
  },
  rowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 8,
    gap: 8,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  rowDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  editBtn: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  rowPressed: {
    opacity: 0.65,
  },
  addRow: {
    marginTop: 16,
    marginBottom: 8,
    alignItems: 'flex-start',
  },
  syncNotice: {
    marginTop: 8,
    lineHeight: 18,
  },
});

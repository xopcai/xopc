import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import type { MessageBundle } from '../../i18n/messages';
import { useMessages } from '../../i18n/messages';
import { SettingsSection, useSettingsColors } from '../settings/settings-ui';
import {
  resolveTunnelStatusUiKey,
  tunnelStatusDetailLine,
  type TunnelStatusUiKey,
} from './tunnel-status-display';
import { useGatewayTunnelStatus } from './use-gateway-tunnel-status';

type GatewayTunnelStatusCardProps = {
  refreshToken?: number;
};

function statusLabel(key: TunnelStatusUiKey, g: MessageBundle['gateway']): string {
  switch (key) {
    case 'loading':
      return g.remoteAccessLoading;
    case 'unavailable':
      return g.remoteAccessNeedToken;
    case 'connected':
      return g.remoteAccessConnected;
    case 'connecting':
      return g.remoteAccessConnecting;
    case 'error':
      return g.remoteAccessError;
    case 'off':
      return g.remoteAccessOff;
  }
}

function statusDotColor(key: TunnelStatusUiKey, colors: ReturnType<typeof useSettingsColors>): string {
  switch (key) {
    case 'connected':
      return colors.success;
    case 'connecting':
      return colors.warning;
    case 'error':
      return colors.error;
    case 'loading':
      return colors.accent;
    default:
      return colors.textMuted;
  }
}

export function GatewayTunnelStatusCard({ refreshToken = 0 }: GatewayTunnelStatusCardProps) {
  const g = useMessages().gateway;
  const colors = useSettingsColors();
  const { status, loading, hasToken } = useGatewayTunnelStatus(refreshToken);

  const uiKey = resolveTunnelStatusUiKey({ loading, hasToken, status });
  const detail = tunnelStatusDetailLine(status);
  const label = statusLabel(uiKey, g);

  return (
    <SettingsSection title={g.remoteAccessTitle} style={styles.section}>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: statusDotColor(uiKey, colors) }]} />
        <View style={styles.textCol}>
          <Text variant="bodyLarge" style={{ color: colors.text }}>
            {label}
          </Text>
          {detail ? (
            <Text variant="bodySmall" style={{ color: colors.textMuted, marginTop: 4 }} numberOfLines={3}>
              {detail}
            </Text>
          ) : null}
          {uiKey === 'off' ? (
            <Text variant="bodySmall" style={{ color: colors.textMuted, marginTop: 4, lineHeight: 18 }}>
              {g.remoteAccessOffHint}
            </Text>
          ) : null}
        </View>
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
});

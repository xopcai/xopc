/**
 * Drawer pill — bg/border morph + foreground opacity dip masks the icon/
 * text colour swap so the whole pill feels like one unified animation.
 * The trailing tune icon and long-press open the manual-route override sheet.
 */
import { memo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { LIST_DELAY_LONG_PRESS } from '../../constants/list-interaction';
import { useMessages } from '../../i18n/messages';
import { useResolvedIsDark } from '../../lib/stack-screen-theme';
import { useGatewayStore } from '../../stores/gateway-store';
import { typography, useTheme } from '../../theme';

import { AnimatedConnectionPill } from './AnimatedConnectionPill';
import {
  copyForConnectionState,
  severityForConnectionState,
  useConnectionState,
} from './connection-state';
import { RouteOverrideMenu } from './RouteOverrideMenu';
import { useActiveGatewayDisplay } from './use-active-gateway-display';

export const DrawerGatewayConnection = memo(function DrawerGatewayConnection({
  onPress,
}: {
  onPress?: () => void;
}) {
  const isDark = useResolvedIsDark();
  const { colors } = useTheme();
  const m = useMessages();
  const display = useActiveGatewayDisplay();
  const state = useConnectionState();
  const severity = severityForConnectionState(state);
  const copy = copyForConnectionState(state, m.gateway.state);
  const routeOverride = useGatewayStore((s) => s.routeOverride);
  const [overrideMenuVisible, setOverrideMenuVisible] = useState(false);

  if (!display.configured) {
    return (
      <Pressable
        style={styles.wrap}
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : undefined}
      >
        <AnimatedConnectionPill severity="idle" isDark={isDark}>
          {({ color }) => (
            <>
              <Icon source="cloud-off-outline" size={14} color={color} />
              <Text style={[styles.pillText, { color }]} numberOfLines={1}>
                {copy.short}
              </Text>
            </>
          )}
        </AnimatedConnectionPill>
      </Pressable>
    );
  }

  const overridePinned = routeOverride !== 'auto';
  const icon = iconForState(state.kind);
  const isProbing = severity === 'pending';

  const subtitleParts: string[] = [];
  if (display.name) subtitleParts.push(display.name);
  if (
    (state.kind === 'ok-lan' || state.kind === 'ok-tunnel' || state.kind === 'ok-direct') &&
    state.latencyMs != null
  ) {
    subtitleParts.push(`${Math.max(0, Math.round(state.latencyMs))} ms`);
  }
  const subtitle = subtitleParts.join(' · ');

  return (
    <>
      <Pressable
        style={styles.wrap}
        onPress={onPress}
        onLongPress={() => setOverrideMenuVisible(true)}
        delayLongPress={LIST_DELAY_LONG_PRESS}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityHint={m.gateway.routeOverride.title}
      >
        <AnimatedConnectionPill severity={severity} isDark={isDark}>
          {({ color }) => (
            <>
              {isProbing ? (
                <ActivityIndicator size={12} color={color} />
              ) : (
                <Icon source={icon} size={14} color={color} />
              )}
              <Text style={[styles.pillText, { color }]} numberOfLines={1}>
                {copy.short}
              </Text>
              <Icon source={overridePinned ? 'pin' : 'tune-variant'} size={12} color={color} />
            </>
          )}
        </AnimatedConnectionPill>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: colors.text.tertiary }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </Pressable>
      <RouteOverrideMenu
        visible={overrideMenuVisible}
        onRequestClose={() => setOverrideMenuVisible(false)}
      />
    </>
  );
});

function iconForState(kind: string): string {
  switch (kind) {
    case 'ok-lan':
      return 'lan-connect';
    case 'ok-tunnel':
      return 'cloud-check-outline';
    case 'ok-direct':
      return 'check-circle-outline';
    case 'degraded-tunnel-only':
      return 'cloud-outline';
    case 'offline-network':
      return 'wifi-off';
    case 'offline-device':
      return 'desktop-classic';
    case 'token-invalid':
      return 'lock-alert';
    case 'no-route':
      return 'alert-circle-outline';
    default:
      return 'progress-clock';
  }
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 6,
    marginBottom: 12,
    gap: 4,
  },
  pillText: {
    ...typography.caption,
    fontWeight: '500',
  },
  subtitle: {
    ...typography.micro,
  },
});

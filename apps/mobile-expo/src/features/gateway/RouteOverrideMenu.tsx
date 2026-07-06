/**
 * Bottom-sheet menu for the manual route override.
 */
import { memo, useCallback } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMessages } from '../../i18n/messages';
import { useGatewayStore } from '../../stores/gateway-store';
import { radii, spacing, typography, useTheme } from '../../theme';

import {
  copyForConnectionState,
  useConnectionState,
} from './connection-state';
import { runProbeRound } from './probe-coordinator';
import type { RouteOverride } from './route-override';

export type RouteOverrideMenuProps = {
  visible: boolean;
  onRequestClose: () => void;
};

export const RouteOverrideMenu = memo(function RouteOverrideMenu({
  visible,
  onRequestClose,
}: RouteOverrideMenuProps) {
  const insets = useSafeAreaInsets();
  const { colors: themeColors } = useTheme();
  const m = useMessages();
  const o = m.gateway.routeOverride;

  const lanUrl = useGatewayStore((s) => s.lanUrl);
  const baseUrl = useGatewayStore((s) => s.baseUrl);
  const current = useGatewayStore((s) => s.routeOverride);
  const setOverride = useGatewayStore((s) => s.setRouteOverride);
  const state = useConnectionState();
  const stateCopy = copyForConnectionState(state, m.gateway.state);

  const colors = {
    bg: themeColors.surface.panel,
    overlay: themeColors.overlay.scrim,
    text: themeColors.text.primary,
    muted: themeColors.text.tertiary,
    border: themeColors.border.default,
    selected: themeColors.accent.selectionBg,
    accent: themeColors.accent.primary,
  };

  const handlePick = useCallback(
    async (next: RouteOverride) => {
      if (next === current) {
        onRequestClose();
        return;
      }
      await setOverride(next);
      onRequestClose();
    },
    [current, onRequestClose, setOverride],
  );

  const handleTest = useCallback(async () => {
    await runProbeRound('manual', { force: true });
    onRequestClose();
  }, [onRequestClose]);

  const lanAvailable = Boolean(lanUrl?.trim());
  const tunnelAvailable = Boolean(baseUrl.trim());

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onRequestClose}
      statusBarTranslucent
    >
      <Pressable style={[styles.overlay, { backgroundColor: colors.overlay }]} onPress={onRequestClose} />
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.bg,
            paddingBottom: insets.bottom + 12,
          },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: colors.border }]} />
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text variant="titleSmall" style={{ color: colors.text }}>
            {o.title}
          </Text>
          <Text variant="bodySmall" style={{ color: colors.muted, marginTop: 2 }} numberOfLines={2}>
            {stateCopy.long}
          </Text>
        </View>

        <Choice
          icon="auto-fix"
          title={o.auto}
          subtitle={o.autoSubtitle}
          selected={current === 'auto'}
          accent={colors.accent}
          onPress={() => void handlePick('auto')}
          colors={colors}
        />
        <Choice
          icon="lan-connect"
          title={o.lan}
          subtitle={lanAvailable ? o.lanSubtitle : o.lanUnavailable}
          selected={current === 'lan'}
          disabled={!lanAvailable}
          accent={colors.accent}
          onPress={() => void handlePick('lan')}
          colors={colors}
        />
        <Choice
          icon="cloud-check-outline"
          title={o.tunnel}
          subtitle={tunnelAvailable ? o.tunnelSubtitle : o.tunnelUnavailable}
          selected={current === 'tunnel'}
          disabled={!tunnelAvailable}
          accent={colors.accent}
          onPress={() => void handlePick('tunnel')}
          colors={colors}
        />

        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <Pressable onPress={() => void handleTest()} style={styles.testRow}>
            <Icon source="refresh" size={16} color={colors.accent} />
            <Text style={{ color: colors.accent, fontWeight: '500' }}>{o.testNow}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
});

type ChoiceProps = {
  icon: string;
  title: string;
  subtitle: string;
  selected: boolean;
  disabled?: boolean;
  accent: string;
  onPress: () => void;
  colors: {
    text: string;
    muted: string;
    selected: string;
    border: string;
  };
};

function Choice({
  icon,
  title,
  subtitle,
  selected,
  disabled,
  accent,
  onPress,
  colors,
}: ChoiceProps) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      android_ripple={disabled ? undefined : { color: colors.selected }}
      style={({ pressed }) => [
        styles.choice,
        {
          backgroundColor: selected ? colors.selected : 'transparent',
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <View style={styles.choiceIcon}>
        <Icon source={icon} size={20} color={selected ? accent : colors.muted} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.choiceTitle, { color: colors.text, fontWeight: selected ? '600' : '500' }]}>
          {title}
        </Text>
        <Text style={[styles.choiceSubtitle, { color: colors.muted }]}>{subtitle}</Text>
      </View>
      {selected ? <Icon source="check" size={18} color={accent} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: spacing.xxs,
    marginBottom: spacing.sm,
    opacity: 0.7,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg - spacing.xxs,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg - spacing.xxs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  choiceIcon: {
    width: 22,
    alignItems: 'center',
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  testRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs + spacing.xxs,
  },
  choiceTitle: {
    ...typography.body,
  },
  choiceSubtitle: {
    ...typography.caption,
    marginTop: spacing.xxs,
  },
});

/**
 * Bottom sheet shown when the connection state machine reports
 * `offline-device`: the cloud relay answered but the user's gateway computer
 * isn't responding. Walks the user through the realistic causes and gives
 * them a one-tap retry + a docs link.
 */
import { memo, useCallback } from 'react';
import { Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMessages } from '../../i18n/messages';
import { useTheme } from '../../theme';

import { runProbeRound } from './probe-coordinator';

const HELP_DOCS_URL = 'https://xopcai.github.io/xopc/troubleshooting';

export type OfflineDeviceHelpSheetProps = {
  visible: boolean;
  onRequestClose: () => void;
};

export const OfflineDeviceHelpSheet = memo(function OfflineDeviceHelpSheet({
  visible,
  onRequestClose,
}: OfflineDeviceHelpSheetProps) {
  const insets = useSafeAreaInsets();
  const { colors: themeColors } = useTheme();
  const m = useMessages();
  const c = m.gateway.offlineDeviceHelp;

  const colors = {
    bg: themeColors.surface.panel,
    overlay: themeColors.overlay.scrim,
    text: themeColors.text.primary,
    muted: themeColors.text.secondary,
    border: themeColors.border.default,
    accent: themeColors.accent.primary,
    icon: themeColors.semantic.warning,
    handle: themeColors.border.strong,
  };

  const handleRetry = useCallback(async () => {
    await runProbeRound('manual', { force: true });
    onRequestClose();
  }, [onRequestClose]);

  const handleDocs = useCallback(() => {
    void Linking.openURL(HELP_DOCS_URL);
  }, []);

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
          { backgroundColor: colors.bg, paddingBottom: insets.bottom + 16 },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: colors.handle }]} />

        <View style={styles.header}>
          <Icon source="desktop-classic" size={32} color={colors.icon} />
          <Text variant="titleMedium" style={{ color: colors.text, marginTop: 10, fontWeight: '600' }}>
            {c.title}
          </Text>
          <Text variant="bodyMedium" style={{ color: colors.muted, marginTop: 6, textAlign: 'center' }}>
            {c.subtitle}
          </Text>
        </View>

        <View style={[styles.causes, { borderTopColor: colors.border, borderBottomColor: colors.border }]}>
          <Cause text={c.cause1} colors={colors} />
          <Cause text={c.cause2} colors={colors} />
          <Cause text={c.cause3} colors={colors} />
          <Cause text={c.cause4} colors={colors} isLast />
        </View>

        <View style={styles.actions}>
          <Button
            mode="contained"
            onPress={() => void handleRetry()}
            icon="refresh"
            style={styles.retryButton}
          >
            {c.retry}
          </Button>
          <View style={styles.secondaryRow}>
            <Pressable onPress={handleDocs} style={styles.secondary}>
              <Text style={{ color: colors.accent, fontWeight: '500' }}>{c.docs}</Text>
            </Pressable>
            <Pressable onPress={onRequestClose} style={styles.secondary}>
              <Text style={{ color: colors.muted }}>{c.dismiss}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
});

function Cause({
  text,
  colors,
  isLast,
}: {
  text: string;
  colors: { text: string; muted: string; border: string };
  isLast?: boolean;
}) {
  return (
    <View
      style={[
        styles.cause,
        !isLast && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <View style={styles.causeBullet}>
        <Icon source="circle-medium" size={12} color={colors.muted} />
      </View>
      <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20, flex: 1 }}>{text}</Text>
    </View>
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
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 8,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 16,
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 18,
  },
  causes: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
  },
  cause: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 12,
  },
  causeBullet: {
    width: 18,
    paddingTop: 4,
  },
  actions: {
    paddingHorizontal: 18,
    paddingTop: 16,
    gap: 10,
  },
  retryButton: {
    borderRadius: 12,
  },
  secondaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 4,
  },
  secondary: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});

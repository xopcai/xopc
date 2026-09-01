import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { useMessages } from '../../i18n/messages';
import { useGatewayStore } from '../../stores/gateway-store';
import { spacing, typography, useTheme } from '../../theme';
import type { GatewayConnectivityError } from '../../api/gateway-error';

import { cancelGatewaySwitch, switchGatewayProfile } from './gateway-switch-service';
import { buildGatewaySwitcherSubtitle } from './gateway-switcher-model';
import { readAnyNetworkLastGoodRoute } from './last-good-route';
import { useGatewayConnectionView } from './use-gateway-connection-view';
import { useGatewayHealth } from './use-gateway-health';

export type GatewaySwitcherSheetProps = {
  visible: boolean;
  onDismiss: () => void;
  onSwitched?: (profileId: string) => void;
  onManage: () => void;
  onAdd: () => void;
  onEdit: (profileId: string) => void;
};

function failedMessage(
  error: GatewayConnectivityError,
  messages: ReturnType<typeof useMessages>,
): string {
  if (error.kind === 'token-invalid') return messages.gateway.state.tokenInvalidLong;
  if (error.kind === 'offline-network') return messages.gateway.state.offlineNetworkLong;
  if (error.kind === 'offline-device') return messages.gateway.state.offlineDeviceLong;
  return messages.gateway.state.noRouteLong;
}

export const GatewaySwitcherSheet = memo(function GatewaySwitcherSheet({
  visible,
  onDismiss,
  onSwitched,
  onManage,
  onAdd,
  onEdit,
}: GatewaySwitcherSheetProps) {
  const { colors } = useTheme();
  const messages = useMessages();
  const copy = messages.gateway.switcher;
  const profiles = useGatewayStore((state) => state.profiles);
  const activeGatewayId = useGatewayStore((state) => state.activeGatewayId);
  const connectionView = useGatewayConnectionView();
  const { gatewayOnline } = useGatewayHealth();
  const [pendingProfileId, setPendingProfileId] = useState<string | null>(null);
  const [failure, setFailure] = useState<{
    profileId: string;
    error: GatewayConnectivityError;
  } | null>(null);
  const uiAttemptRef = useRef(0);

  useEffect(() => {
    if (!visible) return;
    setPendingProfileId(null);
    setFailure(null);
  }, [visible]);

  useEffect(() => () => {
    uiAttemptRef.current++;
    cancelGatewaySwitch();
  }, []);

  const dismiss = useCallback(() => {
    uiAttemptRef.current++;
    cancelGatewaySwitch();
    setPendingProfileId(null);
    setFailure(null);
    onDismiss();
  }, [onDismiss]);

  const selectProfile = useCallback(async (profileId: string) => {
    if (profileId === useGatewayStore.getState().activeGatewayId) {
      dismiss();
      return;
    }
    const uiAttempt = ++uiAttemptRef.current;
    setPendingProfileId(profileId);
    setFailure(null);
    const result = await switchGatewayProfile(profileId);
    if (uiAttempt !== uiAttemptRef.current || result.status === 'superseded') return;
    setPendingProfileId(null);
    if (result.status === 'failed') {
      setFailure({ profileId, error: result.error });
      return;
    }
    setFailure(null);
    onDismiss();
    onSwitched?.(profileId);
  }, [dismiss, onDismiss, onSwitched]);

  const openEdit = useCallback((profileId: string) => {
    dismiss();
    onEdit(profileId);
  }, [dismiss, onEdit]);

  return (
    <BottomSheetModal
      visible={visible}
      onDismiss={dismiss}
      title={copy.title}
      subtitle={copy.subtitle}
      maxHeight="72%"
      scroll={profiles.length > 0}
      footer={
        <View style={styles.footerActions}>
          <Button mode="text" icon="plus" onPress={() => { dismiss(); onAdd(); }}>
            {copy.add}
          </Button>
          <Button mode="outlined" icon="cog-outline" onPress={() => { dismiss(); onManage(); }}>
            {copy.manage}
          </Button>
        </View>
      }
    >
      {pendingProfileId ? (
        <View style={[styles.guard, { backgroundColor: colors.accent.soft }]}>
          <Text style={[styles.guardText, { color: colors.accent.primary }]}>
            {copy.verifying}
          </Text>
        </View>
      ) : null}

      {profiles.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.text.secondary }]}>{copy.empty}</Text>
      ) : profiles.map((profile) => {
        const isActive = profile.id === activeGatewayId;
        const isPending = profile.id === pendingProfileId;
        const rowFailure = failure?.profileId === profile.id ? failure.error : null;
        const subtitle = rowFailure
          ? failedMessage(rowFailure, messages)
          : buildGatewaySwitcherSubtitle({
              profile,
              isActive,
              gatewayOnline,
              hasLastAvailableRoute: Boolean(readAnyNetworkLastGoodRoute(profile.id)),
              connectionView,
              messages,
            });

        return (
          <View key={profile.id}>
            <Pressable
              style={({ pressed }) => [
                styles.row,
                isActive && { backgroundColor: colors.accent.selectionBg },
                pressed && !isPending && { backgroundColor: colors.surface.hover },
              ]}
              onPress={() => { void selectProfile(profile.id); }}
              disabled={isPending}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive, busy: isPending }}
            >
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: rowFailure
                    ? colors.semantic.errorBold
                    : isActive && gatewayOnline
                      ? colors.semantic.success
                      : colors.text.tertiary },
                ]}
              />
              <View style={styles.rowContent}>
                <Text
                  style={[styles.rowName, { color: colors.text.primary }]}
                  numberOfLines={1}
                >
                  {profile.name}
                </Text>
                <Text
                  style={[
                    styles.rowDescription,
                    { color: rowFailure ? colors.semantic.errorBold : colors.text.tertiary },
                  ]}
                  numberOfLines={2}
                >
                  {subtitle}
                </Text>
              </View>
              {isPending ? (
                <ActivityIndicator size={18} />
              ) : isActive ? (
                <Text style={[styles.currentLabel, { color: colors.accent.primary }]}>
                  {copy.current}
                </Text>
              ) : (
                <Icon source="chevron-right" size={18} color={colors.text.tertiary} />
              )}
            </Pressable>
            {rowFailure ? (
              <View style={styles.failureActions}>
                <Button compact mode="text" onPress={() => { void selectProfile(profile.id); }}>
                  {copy.retry}
                </Button>
                <Button compact mode="text" onPress={() => openEdit(profile.id)}>
                  {copy.edit}
                </Button>
              </View>
            ) : null}
          </View>
        );
      })}
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  guard: {
    marginHorizontal: spacing.xs,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 10,
  },
  guardText: { ...typography.caption },
  row: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: 12,
  },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  rowContent: { flex: 1, minWidth: 0 },
  rowName: { ...typography.ui, fontWeight: '600' },
  rowDescription: { ...typography.caption, marginTop: spacing.xxs },
  currentLabel: { ...typography.caption, fontWeight: '600' },
  failureActions: {
    minHeight: 36,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    paddingRight: spacing.sm,
  },
  footerActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  emptyText: { ...typography.body, padding: spacing.xl, textAlign: 'center' },
});

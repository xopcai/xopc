import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { useMessages } from '../../i18n/messages';
import { hapticGatewaySwitchSuccess } from '../../motion/haptics';
import { motion, useReducedMotion } from '../../motion';
import { useGatewayStore } from '../../stores/gateway-store';
import type { GatewayProfile } from '../../stores/gateway-types';
import { spacing, typography, useTheme } from '../../theme';
import type { GatewayConnectivityError } from '../../api/gateway-error';

import { cancelGatewaySwitch, switchGatewayProfile } from './gateway-switch-service';
import { gatewayProfileHost } from '../../stores/gateway-types';
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
  const { gatewayOnline } = useGatewayHealth();
  const [pendingProfileId, setPendingProfileId] = useState<string | null>(null);
  const [failure, setFailure] = useState<{
    profileId: string;
    error: GatewayConnectivityError;
  } | null>(null);
  const uiAttemptRef = useRef(0);
  const stableActiveIdRef = useRef(activeGatewayId);

  useEffect(() => {
    if (!pendingProfileId) stableActiveIdRef.current = activeGatewayId;
  }, [activeGatewayId, pendingProfileId]);

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
    const profile = useGatewayStore.getState().profiles.find((item) => item.gatewayId === profileId);
    hapticGatewaySwitchSuccess();
    if (profile) {
      AccessibilityInfo.announceForAccessibility(
        copy.switched.replace('{{name}}', profile.name),
      );
    }
    onDismiss();
    onSwitched?.(profileId);
  }, [copy.switched, dismiss, onDismiss, onSwitched]);

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
        <Animated.View
          entering={FadeIn.duration(motion.duration.quick)}
          exiting={FadeOut.duration(motion.duration.press)}
          style={[styles.guard, { backgroundColor: colors.accent.soft }]}
          accessibilityLiveRegion="polite"
        >
          <Text style={[styles.guardText, { color: colors.accent.primary }]}>{copy.verifying}</Text>
        </Animated.View>
      ) : null}

      {profiles.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.text.secondary }]}>{copy.empty}</Text>
      ) : profiles.map((profile) => {
        const displayedActiveId = pendingProfileId ? stableActiveIdRef.current : activeGatewayId;
        const isActive = profile.gatewayId === displayedActiveId;
        const isPending = profile.gatewayId === pendingProfileId;
        const rowFailure = failure?.profileId === profile.gatewayId ? failure.error : null;
        const subtitle = rowFailure
          ? failedMessage(rowFailure, messages)
          : `${gatewayProfileHost(profile)} · ${isActive && gatewayOnline ? copy.online : isActive ? copy.offline : ''}`.replace(/ · $/, '');

        return <GatewayProfileRow
          key={profile.gatewayId}
          profile={profile}
          subtitle={subtitle}
          isActive={isActive}
          isPending={isPending}
          disabled={pendingProfileId !== null}
          online={gatewayOnline}
          failure={rowFailure}
          currentLabel={copy.current}
          retryLabel={copy.retry}
          editLabel={copy.edit}
          onSelect={selectProfile}
          onEdit={openEdit}
        />;
      })}
    </BottomSheetModal>
  );
});

type GatewayProfileRowProps = {
  profile: GatewayProfile;
  subtitle: string;
  isActive: boolean;
  isPending: boolean;
  disabled: boolean;
  online: boolean;
  failure: GatewayConnectivityError | null;
  currentLabel: string;
  retryLabel: string;
  editLabel: string;
  onSelect: (profileId: string) => Promise<void>;
  onEdit: (profileId: string) => void;
};

const GatewayProfileRow = memo(function GatewayProfileRow({
  profile,
  subtitle,
  isActive,
  isPending,
  disabled,
  online,
  failure,
  currentLabel,
  retryLabel,
  editLabel,
  onSelect,
  onEdit,
}: GatewayProfileRowProps) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const backgroundColor = useSharedValue(isActive ? colors.accent.selectionBg : 'transparent');
  const dotColor = useSharedValue(
    failure
      ? colors.semantic.errorBold
      : isActive && online
        ? colors.semantic.success
        : colors.text.tertiary,
  );

  useEffect(() => {
    const duration = reducedMotion ? 0 : motion.duration.quick;
    backgroundColor.value = withTiming(
      isActive || isPending ? colors.accent.selectionBg : 'transparent',
      { duration },
    );
    dotColor.value = withTiming(
      failure
        ? colors.semantic.errorBold
        : isActive && online
          ? colors.semantic.success
          : colors.text.tertiary,
      { duration },
    );
  }, [backgroundColor, colors, dotColor, failure, isActive, isPending, online, reducedMotion]);

  const animatedRowStyle = useAnimatedStyle(() => ({
    backgroundColor: backgroundColor.value,
    transform: [{ scale: scale.value }],
  }));
  const animatedDotStyle = useAnimatedStyle(() => ({ backgroundColor: dotColor.value }));
  const accessoryTransition = reducedMotion ? undefined : LinearTransition.duration(motion.duration.quick);

  return (
    <Animated.View layout={accessoryTransition}>
      <Animated.View style={[styles.row, animatedRowStyle]}>
        <Pressable
          style={styles.rowPressTarget}
          onPress={() => { void onSelect(profile.gatewayId); }}
          onPressIn={() => {
            if (!disabled) scale.value = withTiming(0.985, { duration: motion.duration.press });
          }}
          onPressOut={() => {
            scale.value = withTiming(1, { duration: motion.duration.press });
          }}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityState={{ selected: isActive, busy: isPending, disabled }}
        >
          <Animated.View style={[styles.statusDot, animatedDotStyle]} />
          <View style={styles.rowContent}>
            <Text style={[styles.rowName, { color: colors.text.primary }]} numberOfLines={1}>
              {profile.name}
            </Text>
            <Text
              style={[
                styles.rowDescription,
                { color: failure ? colors.semantic.errorBold : colors.text.tertiary },
              ]}
              numberOfLines={2}
            >
              {subtitle}
            </Text>
          </View>
          <Animated.View key={isPending ? 'pending' : isActive ? 'active' : 'idle'} layout={accessoryTransition}>
            {isPending ? (
              <ActivityIndicator size={18} color={colors.accent.primary} />
            ) : isActive ? (
              <Text style={[styles.currentLabel, { color: colors.accent.primary }]}>
                {currentLabel}
              </Text>
            ) : (
              <Icon source="chevron-right" size={18} color={colors.text.tertiary} />
            )}
          </Animated.View>
        </Pressable>
      </Animated.View>
      {failure ? (
        <Animated.View
          entering={reducedMotion ? undefined : FadeIn.duration(motion.duration.quick)}
          exiting={reducedMotion ? undefined : FadeOut.duration(motion.duration.press)}
          style={styles.failureActions}
        >
          <Button compact mode="text" onPress={() => { void onSelect(profile.gatewayId); }}>
            {retryLabel}
          </Button>
          <Button compact mode="text" onPress={() => onEdit(profile.gatewayId)}>
            {editLabel}
          </Button>
        </Animated.View>
      ) : null}
    </Animated.View>
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
    borderRadius: 12,
    overflow: 'hidden',
  },
  rowPressTarget: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
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

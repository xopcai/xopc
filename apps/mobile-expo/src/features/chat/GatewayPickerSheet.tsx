/**
 * Bottom sheet for quick gateway switching within the chat screen.
 */
import { memo, useCallback } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { buildGatewayPickerRowSubtitle } from '../gateway/gateway-picker-subtitle';
import { useGatewayConnectionView } from '../gateway/use-gateway-connection-view';
import { useMessages } from '../../i18n/messages';
import type { GatewayProfile } from '../../stores/gateway-types';
import { useTheme } from '../../theme';

export const GatewayPickerSheet = memo(function GatewayPickerSheet({
  visible,
  profiles,
  activeGatewayId,
  gatewayOnline,
  switchingId,
  onSelect,
  onManageSettings,
  onAddGateway,
  onDismiss,
}: {
  visible: boolean;
  profiles: GatewayProfile[];
  activeGatewayId: string | null;
  gatewayOnline: boolean;
  switchingId: string | null;
  onSelect: (profileId: string) => void;
  onManageSettings: () => void;
  onAddGateway: () => void;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const m = useMessages();
  const c = m.chat;
  const g = m.gateway;
  const connectionView = useGatewayConnectionView();

  const handleSelect = useCallback(
    (profileId: string) => {
      if (switchingId) return;
      onSelect(profileId);
    },
    [onSelect, switchingId],
  );

  return (
    <BottomSheetModal
      visible={visible}
      onDismiss={onDismiss}
      title={c.gatewayPickerTitle}
      maxHeight="70%"
      scroll={profiles.length > 0}
      footer={
        <Button mode="outlined" icon="cog-outline" onPress={onManageSettings}>
          {c.gatewayPickerManage}
        </Button>
      }
    >
      {profiles.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={[styles.emptyText, { color: colors.text.secondary }]}>{c.gatewayPickerEmpty}</Text>
          <Button mode="contained-tonal" onPress={onAddGateway} style={styles.emptyBtn}>
            {c.gatewayPickerAdd}
          </Button>
        </View>
      ) : (
        profiles.map((profile) => {
          const isActive = profile.id === activeGatewayId;
          const isSwitching = switchingId === profile.id;
          const subtitle = buildGatewayPickerRowSubtitle(
            profile,
            isActive,
            connectionView,
            gatewayOnline,
            g,
            c,
          );

          return (
            <Pressable
              key={profile.id}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: isActive ? colors.accent.selectionBg : 'transparent' },
                pressed && !isSwitching && { backgroundColor: colors.surface.hover },
              ]}
              onPress={() => handleSelect(profile.id)}
              disabled={Boolean(switchingId)}
            >
              <View style={styles.rowContent}>
                <Text
                  style={[
                    styles.rowName,
                    { color: isActive ? colors.accent.primary : colors.text.primary },
                    isActive && styles.rowNameActive,
                  ]}
                  numberOfLines={1}
                >
                  {profile.name}
                </Text>
                <Text style={[styles.rowDesc, { color: colors.text.tertiary }]} numberOfLines={2}>
                  {subtitle}
                </Text>
              </View>
              {isSwitching ? (
                <ActivityIndicator size={18} />
              ) : isActive ? (
                <Icon source="check" size={18} color={colors.accent.primary} />
              ) : null}
            </Pressable>
          );
        })
      )}
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 2,
  },
  rowContent: {
    flex: 1,
    marginRight: 8,
  },
  rowName: {
    fontSize: 15,
    fontWeight: '500',
  },
  rowNameActive: {
    fontWeight: '600',
  },
  rowDesc: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  emptyWrap: {
    paddingHorizontal: 8,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
  emptyBtn: {
    alignSelf: 'stretch',
  },
});

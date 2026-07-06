import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import { radii, spacing, typography } from '../../theme';
import {
  formatReachabilityReason,
  reachabilityStatusColor,
  reachabilityStatusLabel,
  type RouteReachabilityInfo,
} from './check-gateway-routes';
import { syncGatewayUrlsFromTunnelQr } from './apply-tunnel-qr-from-api';
import { SettingsSection, useSettingsColors } from '../settings/settings-ui';
import {
  useGatewayConnectionKindLabel,
  useGatewayConnectionView,
} from './use-gateway-connection-view';
import { useGatewayRouteReachability } from './use-gateway-route-reachability';

type GatewayConnectionCardProps = {
  onSyncNotice?: (message: string) => void;
};

function ConnectionRow({
  label,
  value,
  reachability,
  muted,
  isLast,
}: {
  label: string;
  value: string;
  reachability?: RouteReachabilityInfo;
  muted?: boolean;
  isLast?: boolean;
}) {
  const colors = useSettingsColors();
  const g = useMessages().gateway;
  const status = reachability?.status ?? 'not_configured';
  const baseStatusLabel = reachability
    ? reachabilityStatusLabel(status, {
        reachable: g.addressReachable,
        unreachable: g.addressUnreachable,
        checking: g.connectionDetecting,
      })
    : '';
  const statusLabel =
    baseStatusLabel && status === 'reachable' && typeof reachability?.latencyMs === 'number'
      ? `${baseStatusLabel} · ${Math.max(0, Math.round(reachability.latencyMs))} ms`
      : baseStatusLabel;
  const statusColor = reachability
    ? reachabilityStatusColor(status, {
        success: colors.success,
        error: colors.error,
        muted: colors.textMuted,
      })
    : colors.textMuted;
  const reasonText = reachability
    ? formatReachabilityReason(reachability, {
        timeout: g.addressUnreachableReasonTimeout,
        networkError: g.addressUnreachableReasonNetwork,
        networkErrorWithDetail: g.addressUnreachableReasonNetworkDetail,
        invalidUrl: g.addressUnreachableReasonInvalidUrl,
        httpError: g.addressUnreachableReasonHttp,
      })
    : '';

  return (
    <View
      style={[
        styles.row,
        !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
      ]}
    >
      <Text style={[styles.rowLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text
        style={[styles.rowValue, { color: muted ? colors.textMuted : colors.text }]}
        selectable
        numberOfLines={2}
      >
        {value}
      </Text>
      {statusLabel ? (
        <View
          style={[
            styles.rowStatusPill,
            {
              backgroundColor: colors.accentSoft,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.rowStatus, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      ) : null}
      {reasonText ? (
        <Text style={[styles.rowReason, { color: colors.textMuted }]} selectable numberOfLines={4}>
          {reasonText}
        </Text>
      ) : null}
    </View>
  );
}

export function GatewayConnectionCard({ onSyncNotice }: GatewayConnectionCardProps) {
  const g = useMessages().gateway;
  const colors = useSettingsColors();
  const view = useGatewayConnectionView();
  const kindLabel = useGatewayConnectionKindLabel(view, g);
  const { reachability, checking, recheck } = useGatewayRouteReachability(
    view.connectionKind !== 'unconfigured',
  );
  const [refreshingLan, setRefreshingLan] = useState(false);

  const handleRecheck = useCallback(async () => {
    await recheck();
  }, [recheck]);

  const handleRefreshLan = useCallback(async () => {
    setRefreshingLan(true);
    try {
      const result = await syncGatewayUrlsFromTunnelQr();
      if (!result.ok) {
        onSyncNotice?.(g.refreshLanFailed);
      } else if (result.updated || result.activeRouteChanged) {
        onSyncNotice?.(g.refreshLanOk);
      } else {
        onSyncNotice?.(g.refreshLanUnchanged);
      }
      await recheck();
    } finally {
      setRefreshingLan(false);
    }
  }, [g.refreshLanFailed, g.refreshLanOk, g.refreshLanUnchanged, onSyncNotice, recheck]);

  if (view.connectionKind === 'unconfigured') {
    return null;
  }

  const lanDisplay = view.lanHost ?? g.lanNotConfigured;
  const activeReachability =
    view.connectionKind === 'lan' ? reachability.lan : reachability.tunnel;
  const activeRouteUnreachable = activeReachability.status === 'unreachable';
  const activeStatusColor = reachabilityStatusColor(activeReachability.status, {
    success: colors.success,
    error: colors.error,
    muted: colors.textMuted,
  });
  const activeRouteReason = formatReachabilityReason(activeReachability, {
    timeout: g.addressUnreachableReasonTimeout,
    networkError: g.addressUnreachableReasonNetwork,
    networkErrorWithDetail: g.addressUnreachableReasonNetworkDetail,
    invalidUrl: g.addressUnreachableReasonInvalidUrl,
    httpError: g.addressUnreachableReasonHttp,
  });

  return (
    <SettingsSection title={g.connectionStatusTitle} style={styles.section}>
      <View
        style={[
          styles.kindBanner,
          {
            backgroundColor: colors.accentSoft,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View style={styles.bannerHeader}>
          <View style={[styles.bannerIcon, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Icon source="access-point-network" size={18} color={colors.accent} />
          </View>
          <View style={styles.bannerCopy}>
            <Text style={[styles.bannerTitle, { color: colors.text }]}>
              {g.connectionCurrent}: {kindLabel}
            </Text>
            <View
              style={[
                styles.activeStatusPill,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              <View style={[styles.statusDot, { backgroundColor: activeStatusColor }]} />
              <Text style={[styles.activeStatusText, { color: activeStatusColor }]}>
                {reachabilityStatusLabel(activeReachability.status, {
                  reachable: g.addressReachable,
                  unreachable: g.addressUnreachable,
                  checking: g.connectionDetecting,
                })}
              </Text>
            </View>
          </View>
        </View>
        {view.activeHost ? (
          <Text style={[styles.bannerMeta, { color: colors.textMuted }]} numberOfLines={2}>
            {g.connectionActiveUrl}: {view.activeHost}
          </Text>
        ) : null}
        {activeRouteUnreachable && !checking ? (
          <>
            <Text style={[styles.bannerError, { color: colors.error }]}>
              {g.gatewayUnreachable}
            </Text>
            {activeRouteReason ? (
              <Text style={[styles.bannerReason, { color: colors.textMuted }]} selectable>
                {activeRouteReason}
              </Text>
            ) : null}
          </>
        ) : null}
        <View style={styles.actionRow}>
          <Button
            mode="text"
            compact
            loading={checking}
            disabled={checking || refreshingLan}
            onPress={() => void handleRecheck()}
          >
            {g.recheckConnection}
          </Button>
          <Button
            mode="text"
            compact
            loading={refreshingLan}
            disabled={refreshingLan || checking}
            onPress={() => void handleRefreshLan()}
          >
            {g.refreshLanAddress}
          </Button>
        </View>
      </View>
      <ConnectionRow
        label={g.lanAddress}
        value={lanDisplay}
        reachability={reachability.lan}
        muted={!view.lanHost}
      />
      <ConnectionRow
        label={g.tunnelAddress}
        value={view.tunnelHost}
        reachability={reachability.tunnel}
        isLast
      />
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing.lg,
  },
  kindBanner: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bannerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  bannerIcon: {
    width: 34,
    height: 34,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  bannerTitle: {
    ...typography.ui,
  },
  bannerMeta: {
    ...typography.label,
    marginTop: spacing.sm,
  },
  bannerError: {
    ...typography.label,
    fontWeight: '500',
    marginTop: spacing.sm,
  },
  bannerReason: {
    ...typography.caption,
    marginTop: spacing.xxs,
  },
  activeStatusPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  activeStatusText: {
    ...typography.micro,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    marginTop: spacing.sm,
    marginLeft: -spacing.sm,
    gap: spacing.xs,
  },
  row: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  rowLabel: {
    ...typography.label,
    fontWeight: '500',
  },
  rowValue: {
    ...typography.body,
  },
  rowStatusPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  rowStatus: {
    ...typography.micro,
  },
  rowReason: {
    ...typography.caption,
  },
});

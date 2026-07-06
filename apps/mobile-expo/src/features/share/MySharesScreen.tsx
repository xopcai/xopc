/**
 * MySharesScreen — list of every share the user has created on this gateway.
 *
 * Each row offers four actions:
 *   - Preview  (in-app WebView via SharePreviewModal)
 *   - Copy     (share URL → clipboard)
 *   - Extend   (dialog: +1d / +3d / +7d)
 *   - Revoke   (confirm dialog)
 *
 * Hidden complexity:
 *   - Active vs Expired vs Revoked status is derived from `revoked` and
 *     `expired` flags returned by the gateway (see ShareListItem).
 *   - The share `kind` from the server is the storage shape (file vs
 *     directory), NOT the routing kind exposed via /api/shares/auto. We treat
 *     them the same here — both render with the file icon.
 *   - Thumbnails are loaded from `${shareUrl}/thumbnail` (same poller as
 *     ShareSheet uses); placeholder SVG → real jpeg.
 */
import { useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import {
  ActivityIndicator,
  Button,
  Dialog,
  Icon,
  Paragraph,
  Portal,
  Text,
} from 'react-native-paper';

import { setAppClipboardStringAsync } from '../clipboard-intake/write-app-clipboard';
import { useQueryClient } from '@tanstack/react-query';

import { FloatingHeader } from '../../components/FloatingHeader';
import { BottomSheetModal } from '../../components/BottomSheetModal';

import { t, useMessages } from '../../i18n/messages';
import { LIST_DELAY_LONG_PRESS } from '../../constants/list-interaction';
import { dismissOrHome, useDismissOnHardwareBack } from '../../lib/navigation';
import { useGatewayStore } from '../../stores/gateway-store';
import { radii, spacing, typography, type ColorScheme } from '../../theme';
import { useTheme } from '../../theme/useTheme';
import { queryKeys } from '../../query/keys';
import {
  useExtendShare,
  useRevokeShare,
  useShareList,
} from '../../query/shares';
import { useRouter } from 'expo-router';
import type { ShareListItem } from '../../api/share';
import { SharePreviewModal } from './SharePreviewModal';
import { formatRelativeDuration, shareStatus, type ShareStatus } from './share-time';

const EXTEND_OPTIONS_MS = {
  '1d': 24 * 60 * 60_000,
  '3d': 3 * 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
} as const;

type ExtendPreset = keyof typeof EXTEND_OPTIONS_MS;

export function MySharesScreen() {
  const router = useRouter();
  useDismissOnHardwareBack(router);
  const { colors } = useTheme();
  const m = useMessages();
  const pm = m.sharingPage;
  const qc = useQueryClient();
  const list = useShareList();
  const token = useGatewayStore((s) => s.token);

  const [extending, setExtending] = useState<ShareListItem | null>(null);
  const [revoking, setRevoking] = useState<ShareListItem | null>(null);
  const [previewing, setPreviewing] = useState<{ url: string; title: string } | null>(null);
  const extend = useExtendShare();
  const revoke = useRevokeShare();

  const palette = useShareListColors(colors);

  const onRefresh = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.shares });
  };

  const renderItem = ({ item }: { item: ShareListItem }) => (
    <ShareRow
      item={item}
      token={token}
      palette={palette}
      onPreview={() => setPreviewing({ url: item.shareUrl, title: item.fileName })}
      onExtend={() => setExtending(item)}
      onRevoke={() => setRevoking(item)}
      m={m}
    />
  );

  const empty = (
    <View style={styles.empty}>
      <Text style={[styles.emptyTitle, { color: palette.text }]}>{pm.empty}</Text>
      <Text style={[styles.emptyHint, { color: palette.muted }]}>{pm.emptyHint}</Text>
    </View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: palette.bg }]}>
      <FloatingHeader title={pm.title} onBack={() => dismissOrHome(router)} />

      {list.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={list.data ?? []}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <Text style={[styles.subtitle, { color: palette.muted }]}>{pm.subtitle}</Text>
          }
          ListEmptyComponent={empty}
          refreshControl={
            <RefreshControl refreshing={list.isFetching && !list.isLoading} onRefresh={onRefresh} />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}

      <ExtendDialog
        visible={Boolean(extending)}
        target={extending}
        onDismiss={() => setExtending(null)}
        onPick={async (preset) => {
          if (!extending) return;
          try {
            await extend.mutateAsync({ id: extending.id, extendTtlMs: EXTEND_OPTIONS_MS[preset] });
          } catch {
            /* surfaced through mutation state — keep dialog open if you wanted */
          } finally {
            setExtending(null);
          }
        }}
        m={m}
      />

      <RevokeDialog
        visible={Boolean(revoking)}
        target={revoking}
        loading={revoke.isPending}
        onDismiss={() => setRevoking(null)}
        onConfirm={async () => {
          if (!revoking) return;
          try {
            await revoke.mutateAsync(revoking.id);
          } catch {
            /* mutation error surfaces via list refresh */
          } finally {
            setRevoking(null);
          }
        }}
        m={m}
      />

      <SharePreviewModal
        visible={Boolean(previewing)}
        url={previewing?.url ?? null}
        title={previewing?.title ?? null}
        onClose={() => setPreviewing(null)}
      />
    </View>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────────

function ShareRow({
  item,
  token,
  palette,
  onPreview,
  onExtend,
  onRevoke,
  m,
}: {
  item: ShareListItem;
  token: string;
  palette: ShareListColors;
  onPreview: () => void;
  onExtend: () => void;
  onRevoke: () => void;
  m: ReturnType<typeof useMessages>;
}) {
  const pm = m.sharingPage;
  const status = shareStatus(item);
  const expiryLabel = useMemo(() => formatExpiryLabel(item, pm), [item, pm]);
  const downloads = item.downloadCount;
  const thumbnailUri = `${item.shareUrl.replace(/\/+$/, '')}/thumbnail`;
  const thumbHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;
  const [actionsVisible, setActionsVisible] = useState(false);

  const closeActions = () => setActionsVisible(false);

  const handleCopy = async () => {
    await setAppClipboardStringAsync(item.shareUrl);
    closeActions();
  };

  const handleSystemShare = async () => {
    try {
      await Share.share({ message: `${item.fileName}\n${item.shareUrl}`, url: item.shareUrl, title: item.fileName });
    } catch {
      /* user cancelled */
    } finally {
      closeActions();
    }
  };

  return (
    <>
    <Pressable
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: palette.cardBg, borderColor: palette.border },
        pressed && styles.pressed,
      ]}
      onPress={onPreview}
      onLongPress={() => setActionsVisible(true)}
      delayLongPress={LIST_DELAY_LONG_PRESS}
      accessibilityRole="button"
      accessibilityLabel={pm.actionPreview}
    >
      <View style={styles.cardLeft}>
        <View style={[styles.thumb, { backgroundColor: palette.thumbBg }]}>
          <Image source={{ uri: thumbnailUri, headers: thumbHeaders }} style={styles.thumbImage} resizeMode="cover" />
        </View>
      </View>

      <View style={styles.cardMain}>
        <Text style={[styles.fileName, { color: palette.text }]} numberOfLines={1}>
          {item.fileName}
        </Text>
        <Text style={[styles.urlLine, { color: palette.muted }]} numberOfLines={1}>
          {item.shareUrl}
        </Text>
        <View style={styles.metaRow}>
          <StatusChip status={status} m={m} />
          <Text style={[styles.metaText, { color: palette.muted }]} numberOfLines={1}>
            {expiryLabel}
            {downloads > 0 ? ` · ${t(pm.downloadsLabel, { count: downloads })}` : ''}
          </Text>
        </View>
      </View>
    </Pressable>
    <ShareActionsSheet
      visible={actionsVisible}
      item={item}
      palette={palette}
      onDismiss={closeActions}
      onPreview={() => {
        closeActions();
        onPreview();
      }}
      onCopy={() => void handleCopy()}
      onShare={() => void handleSystemShare()}
      onExtend={() => {
        closeActions();
        onExtend();
      }}
      onRevoke={() => {
        closeActions();
        onRevoke();
      }}
      m={m}
    />
    </>
  );
}

function ShareActionsSheet({
  visible,
  item,
  palette,
  onDismiss,
  onPreview,
  onCopy,
  onShare,
  onExtend,
  onRevoke,
  m,
}: {
  visible: boolean;
  item: ShareListItem;
  palette: ShareListColors;
  onDismiss: () => void;
  onPreview: () => void;
  onCopy: () => void;
  onShare: () => void;
  onExtend: () => void;
  onRevoke: () => void;
  m: ReturnType<typeof useMessages>;
}) {
  const pm = m.sharingPage;
  return (
    <BottomSheetModal
      visible={visible}
      onDismiss={onDismiss}
      title={item.fileName}
      subtitle={item.shareUrl}
      maxHeight="60%"
    >
      <View style={styles.sheetBody}>
        <ShareSheetAction icon="eye-outline" label={pm.actionPreview} palette={palette} onPress={onPreview} />
        <ShareSheetAction icon="content-copy" label={pm.actionCopy} palette={palette} onPress={onCopy} />
        <ShareSheetAction icon="share-variant" label={pm.actionShare} palette={palette} onPress={onShare} />
        <ShareSheetAction
          icon="clock-plus-outline"
          label={pm.actionExtend}
          palette={palette}
          onPress={onExtend}
          disabled={item.revoked}
        />
        <ShareSheetAction
          icon="link-off"
          label={pm.actionRevoke}
          palette={palette}
          onPress={onRevoke}
          disabled={item.revoked}
          destructive
        />
      </View>
    </BottomSheetModal>
  );
}

function ShareSheetAction({
  icon,
  label,
  palette,
  onPress,
  disabled,
  destructive,
}: {
  icon: string;
  label: string;
  palette: ShareListColors;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.sheetAction,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={[styles.sheetActionIcon, { backgroundColor: palette.thumbBg }]}>
        <Icon source={icon} size={22} color={destructive ? palette.error : palette.muted} />
      </View>
      <Text style={[styles.sheetActionText, { color: destructive ? palette.error : palette.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function StatusChip({ status, m }: { status: ShareStatus; m: ReturnType<typeof useMessages> }) {
  const { colors } = useTheme();
  const pm = m.sharingPage;
  const palette: Record<ShareStatus, { bg: string; fg: string; label: string }> = {
    active: { bg: colors.surface.input, fg: colors.semantic.success, label: pm.statusActive },
    expired: { bg: colors.surface.input, fg: colors.semantic.warning, label: pm.statusExpired },
    revoked: { bg: colors.surface.input, fg: colors.semantic.errorBold, label: pm.statusRevoked },
  };
  const v = palette[status];
  return (
    <View style={[styles.chip, { backgroundColor: v.bg }]}>
      <Text style={[styles.chipText, { color: v.fg }]}>{v.label}</Text>
    </View>
  );
}

// ── Dialogs ─────────────────────────────────────────────────────────────────

function ExtendDialog({
  visible,
  target,
  onDismiss,
  onPick,
  m,
}: {
  visible: boolean;
  target: ShareListItem | null;
  onDismiss: () => void;
  onPick: (preset: ExtendPreset) => void;
  m: ReturnType<typeof useMessages>;
}) {
  const pm = m.sharingPage;
  const { colors } = useTheme();
  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss}>
        <Dialog.Title>{pm.extendDialogTitle}</Dialog.Title>
        <Dialog.Content>
          <Paragraph>{pm.extendDialogBody}</Paragraph>
          {target ? (
            <Text style={{ marginTop: spacing.sm, color: colors.text.secondary }} numberOfLines={1}>
              {target.fileName}
            </Text>
          ) : null}
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={() => onPick('1d')}>{pm.extend1d}</Button>
          <Button onPress={() => onPick('3d')}>{pm.extend3d}</Button>
          <Button onPress={() => onPick('7d')} mode="contained">{pm.extend7d}</Button>
        </Dialog.Actions>
        <Dialog.Actions>
          <Button onPress={onDismiss}>{m.common.cancel}</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

function RevokeDialog({
  visible,
  target,
  loading,
  onDismiss,
  onConfirm,
  m,
}: {
  visible: boolean;
  target: ShareListItem | null;
  loading: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
  m: ReturnType<typeof useMessages>;
}) {
  const pm = m.sharingPage;
  const { colors } = useTheme();
  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss}>
        <Dialog.Title>{pm.revokeDialogTitle}</Dialog.Title>
        <Dialog.Content>
          <Paragraph>{pm.revokeDialogBody}</Paragraph>
          {target ? (
            <Text style={{ marginTop: spacing.sm, color: colors.text.secondary }} numberOfLines={1}>
              {target.fileName}
            </Text>
          ) : null}
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onDismiss} disabled={loading}>{m.common.cancel}</Button>
          <Button onPress={onConfirm} loading={loading} disabled={loading} textColor={colors.semantic.errorBold}>
            {pm.actionRevoke}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatExpiryLabel(item: ShareListItem, pm: ReturnType<typeof useMessages>['sharingPage']): string {
  const deltaMs = new Date(item.expiresAt).getTime() - Date.now();
  const formatted = formatRelativeDuration(deltaMs, pm);
  const tpl = deltaMs >= 0 ? pm.expiresIn : pm.expiredAgo;
  // Replace {{when}} directly to avoid pulling in `t` here (keeps this function pure).
  return tpl.replace('{{when}}', formatted);
}

type ShareListColors = ReturnType<typeof useShareListColors>;

function useShareListColors(colors: ColorScheme) {
  return {
    bg: colors.surface.base,
    cardBg: colors.surface.panel,
    thumbBg: colors.surface.input,
    border: colors.border.default,
    text: colors.text.primary,
    muted: colors.text.secondary,
    error: colors.semantic.error,
  };
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { padding: spacing.lg, paddingBottom: 40, gap: 0 },
  separator: { height: spacing.md },
  subtitle: { ...typography.label, marginBottom: spacing.md },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  cardLeft: {},
  cardMain: { flex: 1, gap: spacing.xs, minWidth: 0 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  thumbImage: { width: '100%', height: '100%' },
  fileName: { ...typography.ui, fontWeight: '600' },
  urlLine: typography.micro,
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  metaText: { ...typography.micro, flexShrink: 1 },
  sheetBody: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  sheetAction: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  sheetActionIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetActionText: { ...typography.ui, fontWeight: '600' },
  chip: {
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  chipText: { ...typography.micro, fontWeight: '700' },
  empty: { alignItems: 'center', paddingVertical: spacing.xxxl, gap: spacing.sm },
  emptyTitle: { ...typography.heading, fontWeight: '600' },
  emptyHint: { ...typography.label, textAlign: 'center', paddingHorizontal: spacing.xxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

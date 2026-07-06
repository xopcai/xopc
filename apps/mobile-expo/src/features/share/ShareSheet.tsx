/**
 * ShareSheet — bottom-sheet modal that takes a workspace file path, calls
 * `POST /api/shares/auto`, and surfaces:
 *
 *  - The generated link's auto-rendered thumbnail (with live readiness poll).
 *  - The share URL + reachability chip (so the user knows whether a friend
 *    can actually open it).
 *  - Two primary actions: Copy link, System share (opens iOS/Android sheet
 *    where WeChat appears as one of the targets).
 *
 * Triggering: caller controls `visible` + `request`. The sheet auto-creates
 * the share the first time it becomes visible for a given request — caller
 * does NOT need to fire the mutation themselves.
 */
import { useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { ActivityIndicator, Icon, Text } from 'react-native-paper';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { t, useMessages } from '../../i18n/messages';
import { radii, spacing, typography, type ColorScheme } from '../../theme';
import { useTheme } from '../../theme/useTheme';
import { useCreateShare, useThumbnailReadiness, thumbnailUrlWithCacheBust } from '../../query/shares';
import type {
  ShareAutoPayload,
  ShareAutoRequest,
  ShareReachability,
} from '../../api/share';
import { setAppClipboardStringAsync } from '../clipboard-intake/write-app-clipboard';
import { SharePreviewModal } from './SharePreviewModal';

export type ShareSheetProps = {
  visible: boolean;
  request: ShareAutoRequest | null;
  onClose: () => void;
};

export const ShareSheet = memo(function ShareSheet({ visible, request, onClose }: ShareSheetProps) {
  const { colors } = useTheme();
  const m = useMessages();

  const { mutate, data, error, isPending, reset } = useCreateShare();

  // Fire-once trigger when the sheet becomes visible for a given request.
  const requestKey = useMemo(() => (request ? JSON.stringify(request) : ''), [request]);
  useEffect(() => {
    if (!visible) return;
    if (!request) return;
    reset();
    mutate(request);
    // Key on requestKey (stringified) rather than request identity so re-renders
    // with structurally equal requests don't re-fire the share creation.
  }, [visible, requestKey, request, mutate, reset]);

  const { status: thumbStatus } = useThumbnailReadiness(
    data?.thumbnail.url,
    data?.thumbnail.status,
  );

  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const [qrOpen, setQrOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  useEffect(() => {
    // Close sub-views whenever the parent sheet closes so re-opening doesn't
    // restore a stale sub-view.
    if (!visible) {
      setQrOpen(false);
      setPreviewOpen(false);
    }
  }, [visible]);

  const handleCopy = useCallback(async () => {
    if (!data?.share.shareUrl) return;
    await setAppClipboardStringAsync(data.share.shareUrl);
    setCopied(true);
  }, [data?.share.shareUrl]);

  const handleSystemShare = useCallback(async () => {
    if (!data?.share.shareUrl) return;
    try {
      await Share.share({
        message: `${data.share.title}\n${data.share.shareUrl}`,
        url: data.share.shareUrl,
        title: data.share.title,
      });
    } catch {
      /* user cancelled — that's fine */
    }
  }, [data?.share.shareUrl, data?.share.title]);

  const palette = useColors(colors);

  return (
    <>
      <BottomSheetModal
        visible={visible}
        onDismiss={onClose}
        title={m.share.sheetTitle}
        maxHeight="86%"
        scroll={Boolean(data)}
      >
        {isPending ? (
          <View style={styles.center}>
            <ActivityIndicator />
            <Text style={[styles.muted, { color: palette.muted }]}>{m.share.creating}</Text>
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={[styles.error, { color: palette.error }]}>
              {t(m.share.createFailed, { message: error.message })}
            </Text>
          </View>
        ) : data ? (
          <ShareSheetBody
            payload={data}
            palette={palette}
            thumbStatus={thumbStatus}
            copied={copied}
            onCopy={handleCopy}
            onSystemShare={handleSystemShare}
            onOpenQr={() => setQrOpen(true)}
            onPreview={() => setPreviewOpen(true)}
            onClose={onClose}
            m={m}
          />
        ) : null}
      </BottomSheetModal>
      <QrShareView
        visible={qrOpen && Boolean(data)}
        url={data?.share.shareUrl ?? ''}
        title={data?.share.title ?? ''}
        onClose={() => setQrOpen(false)}
        palette={palette}
        m={m}
      />
      <SharePreviewModal
        visible={previewOpen && Boolean(data)}
        url={data?.share.shareUrl ?? null}
        title={data?.share.title ?? null}
        onClose={() => setPreviewOpen(false)}
      />
    </>
  );
});

// ── Body ────────────────────────────────────────────────────────────────────

type Palette = ReturnType<typeof useColors>;

function ShareSheetBody({
  payload,
  palette,
  thumbStatus,
  copied,
  onCopy,
  onSystemShare,
  onOpenQr,
  onPreview,
  onClose,
  m,
}: {
  payload: ShareAutoPayload;
  palette: Palette;
  thumbStatus: 'ready' | 'pending' | 'gone' | 'unknown' | 'unavailable';
  copied: boolean;
  onCopy: () => void;
  onSystemShare: () => void;
  onOpenQr: () => void;
  onPreview: () => void;
  onClose: () => void;
  m: ReturnType<typeof useMessages>;
}) {
  const router = useRouter();
  const thumbnailUri = thumbnailUrlWithCacheBust(payload.thumbnail.url, thumbStatus);
  const reachability = payload.share.reachability;
  const routingHint = routingLine(payload.routing.reason, m);
  const notPublic = reachability !== 'public';

  return (
    <View style={styles.body}>
      <View style={[styles.thumbnailFrame, { backgroundColor: palette.tile }]}>
        {thumbnailUri ? (
          <Image source={{ uri: thumbnailUri }} style={styles.thumbnail} resizeMode="cover" />
        ) : null}
        {thumbStatus === 'pending' ? (
          <View style={[styles.thumbnailPendingOverlay, { backgroundColor: palette.scrim }]}>
            <ActivityIndicator size="small" color={palette.inverse} />
            <Text style={[styles.thumbnailPendingText, { color: palette.inverse }]}>
              {m.share.thumbnailPending}
            </Text>
          </View>
        ) : null}
      </View>

      <Text style={[styles.titleLine, { color: palette.text }]} numberOfLines={2}>
        {payload.share.title}
      </Text>

      <Text style={[styles.urlLine, { color: palette.muted }]} numberOfLines={1} selectable>
        {payload.share.shareUrl}
      </Text>

      <ReachabilityChip
        reachability={reachability}
        hint={payload.share.reachabilityHint}
        palette={palette}
        m={m}
      />

      {notPublic ? (
        <View style={[styles.gateBanner, { borderColor: palette.error, backgroundColor: palette.tile }]}>
          <Icon source="alert-circle-outline" size={16} color={palette.error} />
          <Text style={[styles.gateBannerText, { color: palette.text }]} numberOfLines={3}>
            {m.share.reachabilityBlocker}
          </Text>
          <Pressable
            onPress={() => {
              onClose();
              router.push('/settings/gateway' as never);
            }}
            style={({ pressed }) => [styles.gateBannerAction, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={m.share.openTunnelSettings}
          >
            <Text style={[styles.gateBannerActionText, { color: palette.primary }]}>
              {m.share.openTunnelSettings}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {routingHint ? (
        <Text style={[styles.routingHint, { color: palette.muted }]} numberOfLines={2}>
          {routingHint}
        </Text>
      ) : null}

      <View style={styles.actionsRow}>
        <ActionButton
          icon={copied ? 'check' : 'content-copy'}
          label={copied ? m.share.actionCopied : m.share.actionCopy}
          onPress={onCopy}
          palette={palette}
        />
        <ActionButton
          icon="qrcode"
          label={m.share.actionQr}
          onPress={onOpenQr}
          palette={palette}
        />
        <ActionButton
          icon="eye-outline"
          label={m.share.actionOpen}
          onPress={onPreview}
          palette={palette}
        />
        <ActionButton
          icon="share-variant"
          label={m.share.actionShare}
          onPress={onSystemShare}
          palette={palette}
          primary
        />
      </View>

      <Pressable
        onPress={() => {
          onClose();
          router.push('/sharing');
        }}
        style={({ pressed }) => [styles.manageLink, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={m.share.manageAll}
      >
        <Text style={[styles.manageLinkText, { color: palette.primary }]}>{m.share.manageAll}</Text>
      </Pressable>
    </View>
  );
}

// ── QR full-screen view ─────────────────────────────────────────────────────

function QrShareView({
  visible,
  url,
  title,
  onClose,
  palette,
  m,
}: {
  visible: boolean;
  url: string;
  title: string;
  onClose: () => void;
  palette: Palette;
  m: ReturnType<typeof useMessages>;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Make the QR square ~80% of the shorter screen edge, capped so it doesn't
  // dominate ultra-wide tablet layouts.
  const qrSize = Math.min(Math.min(width, height) * 0.8, 360);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={[styles.qrBackdrop, { backgroundColor: palette.qrBackdrop }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={m.share.close}
      >
        <View
          style={[
            styles.qrCard,
            {
              backgroundColor: palette.qrCard,
              marginTop: insets.top + spacing.xl,
              marginBottom: insets.bottom + spacing.xl,
            },
          ]}
          // Stop the inner card from forwarding the press to the backdrop.
          onStartShouldSetResponder={() => true}
        >
          <Text style={[styles.qrTitle, { color: palette.qrText }]}>{m.share.qrTitle}</Text>
          <Text style={[styles.qrSubtitle, { color: palette.qrMuted }]}>{m.share.qrSubtitle}</Text>
          <View style={[styles.qrFrame, { backgroundColor: palette.qrCard }]}>
            {url ? <QRCode value={url} size={qrSize} backgroundColor="#FFFFFF" color="#0F172A" /> : null}
          </View>
          <Text style={[styles.qrName, { color: palette.qrText }]} numberOfLines={2}>
            {title}
          </Text>
          <Text style={[styles.qrUrl, { color: palette.qrMuted }]} numberOfLines={1} selectable>
            {url}
          </Text>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.qrClose,
              { backgroundColor: palette.tile },
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={m.share.close}
          >
            <Text style={[styles.qrCloseText, { color: palette.qrText }]}>{m.share.close}</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  palette,
  primary = false,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  palette: Palette;
  primary?: boolean;
}) {
  const bg = primary ? palette.primary : palette.tile;
  const fg = primary ? palette.primaryText : palette.text;
  return (
    <Pressable
      style={({ pressed }) => [styles.actionButton, { backgroundColor: bg }, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon source={icon} size={22} color={fg} />
      <Text style={[styles.actionLabel, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function ReachabilityChip({
  reachability,
  hint,
  palette,
  m,
}: {
  reachability: ShareReachability;
  hint: string | null;
  palette: Palette;
  m: ReturnType<typeof useMessages>;
}) {
  const map: Record<ShareReachability, { color: string; dot: string; label: string }> = {
    public: { color: palette.muted, dot: palette.success, label: m.share.reachabilityPublic },
    lan: { color: palette.muted, dot: palette.warning, label: m.share.reachabilityLan },
    'local-only': { color: palette.error, dot: palette.error, label: m.share.reachabilityLocal },
  };
  const v = map[reachability];
  return (
    <View style={styles.chipRow}>
      <View style={[styles.chipDot, { backgroundColor: v.dot }]} />
      <Text style={[styles.chipText, { color: v.color }]} numberOfLines={2}>
        {v.label}
        {hint && reachability !== 'local-only' ? ` · ${hint}` : ''}
      </Text>
    </View>
  );
}

function routingLine(
  reason: ShareAutoPayload['routing']['reason'],
  m: ReturnType<typeof useMessages>,
): string {
  switch (reason) {
    case 'html-single-file': return m.share.routingHtmlSingleFile;
    case 'html-with-assets': return m.share.routingHtmlWithAssets;
    case 'small-image': return m.share.routingSmallImage;
    case 'large-binary': return m.share.routingLargeBinary;
    case 'directory-browse': return m.share.routingDirectoryBrowse;
    case 'directory-zip': return m.share.routingDirectoryZip;
    case 'forced': return m.share.routingForced;
    default: return '';
  }
}

function useColors(colors: ColorScheme) {
  return {
    surface: colors.surface.panel,
    tile: colors.surface.input,
    text: colors.text.primary,
    muted: colors.text.secondary,
    inverse: colors.text.inverse,
    primaryText: colors.accent.onPrimary,
    primary: colors.accent.primary,
    success: colors.semantic.success,
    warning: colors.semantic.warning,
    error: colors.semantic.errorBold,
    scrim: colors.overlay.scrim,
    qrBackdrop: colors.overlay.scrim,
    qrCard: colors.surface.base,
    qrText: colors.text.primary,
    qrMuted: colors.text.secondary,
  };
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  muted: {
    ...typography.ui,
  },
  error: {
    textAlign: 'center',
    ...typography.ui,
  },
  body: {
    gap: spacing.md,
  },
  thumbnailFrame: {
    width: '100%',
    aspectRatio: 1200 / 630,
    borderRadius: radii.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  thumbnailPendingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  thumbnailPendingText: {
    ...typography.caption,
  },
  titleLine: {
    ...typography.heading,
    fontWeight: '600',
  },
  urlLine: {
    ...typography.caption,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chipText: {
    ...typography.caption,
    flex: 1,
  },
  routingHint: {
    ...typography.caption,
  },
  gateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  gateBannerText: {
    flex: 1,
    ...typography.caption,
  },
  gateBannerAction: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  gateBannerActionText: {
    ...typography.caption,
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  actionButton: {
    flex: 1,
    minWidth: 0,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.lg,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  actionLabel: {
    ...typography.caption,
    fontWeight: '600',
    textAlign: 'center',
  },
  manageLink: {
    alignItems: 'center',
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
  },
  manageLinkText: {
    ...typography.label,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.75,
  },
  qrBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  qrCard: {
    borderRadius: radii.xl,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
    maxWidth: 420,
    width: '100%',
  },
  qrTitle: {
    ...typography.heading,
    fontWeight: '700',
  },
  qrSubtitle: {
    ...typography.label,
    textAlign: 'center',
  },
  qrFrame: {
    padding: spacing.md,
    borderRadius: radii.lg,
  },
  qrName: {
    ...typography.ui,
    fontWeight: '600',
    textAlign: 'center',
  },
  qrUrl: {
    ...typography.micro,
    textAlign: 'center',
  },
  qrClose: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  qrCloseText: {
    ...typography.ui,
    fontWeight: '600',
  },
});

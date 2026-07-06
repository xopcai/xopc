import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import type { ShareAutoRequest } from '../../api/share';
import { t, useMessages } from '../../i18n/messages';
import { useGatewayStore } from '../../stores/gateway-store';
import { useTheme } from '../../theme';
import { setAppClipboardStringAsync } from '../clipboard-intake/write-app-clipboard';
import { ShareSheet } from '../share/ShareSheet';
import { mapManageRouteToAppPath } from './file-reference-routes';
import { FilePreviewModal, type PreviewableFile } from './FilePreviewModal';
import type { ExtractedFilePath } from './tool-result-file-paths';
import { isImageMimeType } from './tool-result-file-paths';
import {
  resolveWorkspaceFileReference,
  type FileReferenceLocationKind,
  type FileReferenceScope,
  type WorkspaceFileReference,
} from './workspace-api';

type ResolvedArtifact = ExtractedFilePath & { refInfo: WorkspaceFileReference };
type VisiblePath = ResolvedArtifact & { rel: string };

function normalizeRel(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function artifactRowKey(path: ExtractedFilePath, index: number): string {
  const rel = path.workspaceRelativePath?.replace(/\\/g, '/').trim();
  if (rel) return `rel:${rel}`;
  if (path.absolutePath) return `abs:${path.absolutePath}`;
  return `artifact-${index}`;
}

function rawPath(rel: string, sessionKey?: string | null): string {
  const params = new URLSearchParams({ path: rel });
  const sk = sessionKey?.trim();
  if (sk) params.set('sessionKey', sk);
  return `/api/workspace/editor/raw?${params.toString()}`;
}

function toPreviewable(path: VisiblePath): PreviewableFile {
  return {
    name: path.fileName,
    mimeType: path.mimeType,
    workspaceRelativePath: path.rel,
    absolutePath: path.refInfo.absolutePath,
  };
}

function isOffWorkspaceScope(scope: FileReferenceScope): boolean {
  return scope === 'external' || scope === 'agent-profile' || scope === 'session-artifact';
}

function locationKindBadgeLabel(
  kind: FileReferenceLocationKind | undefined,
  m: ReturnType<typeof useMessages>,
): string {
  if (!kind) return m.chat.fileReferenceExternalBadge;
  return m.chat.fileReferenceLocationKind[kind] ?? m.chat.fileReferenceExternalBadge;
}

function fileReferenceDescription(refInfo: WorkspaceFileReference, m: ReturnType<typeof useMessages>) {
  if (refInfo.scope === 'missing') return m.chat.fileReferenceMissingDescription;
  if (refInfo.scope === 'invalid') return m.chat.fileReferenceInvalidDescription;
  if (isOffWorkspaceScope(refInfo.scope) && refInfo.exists) {
    return m.chat.fileReferenceOffWorkspaceBaseDescription;
  }
  return m.chat.fileReferenceExternalDescription;
}

function OffWorkspaceArtifactCard({
  path,
  refInfo,
  border,
  chipBg,
  textColor,
  muted,
  warning,
}: {
  path: ExtractedFilePath;
  refInfo: WorkspaceFileReference;
  border: string;
  chipBg: string;
  textColor: string;
  muted: string;
  warning: string;
}) {
  const router = useRouter();
  const m = useMessages();
  const displayPath = refInfo.absolutePath ?? path.absolutePath;
  const isMissingOrInvalid = refInfo.scope === 'missing' || refInfo.scope === 'invalid';
  const offWorkspace = isOffWorkspaceScope(refInfo.scope) && refInfo.exists;
  const icon = isMissingOrInvalid ? 'alert-circle-outline' : 'file-outline';
  const iconColor = isMissingOrInvalid ? warning : muted;
  const appRoute = mapManageRouteToAppPath(refInfo.manageRoute);
  const showSettingsHint =
    refInfo.manageRoute && !appRoute && (refInfo.locationKind === 'xopc-skills' || refInfo.locationKind === 'xopc-sessions');

  const copyPath = () => {
    void setAppClipboardStringAsync(displayPath);
  };

  return (
    <View
      style={[
        styles.externalCard,
        {
          borderColor: isMissingOrInvalid ? warning : border,
          backgroundColor: chipBg,
        },
      ]}
    >
      <View style={styles.externalHeader}>
        <Icon source={icon} size={16} color={iconColor} />
        <Text style={[styles.externalTitle, { color: textColor }]} numberOfLines={1}>
          {path.fileName || refInfo.displayName}
        </Text>
        {offWorkspace || refInfo.scope === 'external' || refInfo.scope === 'agent-profile' ? (
          <Text style={[styles.badge, { color: muted, borderColor: border }]}>
            {locationKindBadgeLabel(refInfo.locationKind, m)}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.externalDescription, { color: muted }]}>
        {fileReferenceDescription(refInfo, m)}
      </Text>
      {showSettingsHint ? (
        <Text style={[styles.externalDescription, { color: muted }]}>{m.chat.fileReferenceManageOnDesktop}</Text>
      ) : null}
      <View style={styles.actionRow}>
        {appRoute ? (
          <Pressable
            style={({ pressed }) => [styles.copyButton, { borderColor: border }, pressed && styles.pressed]}
            onPress={() => router.push(appRoute as never)}
            accessibilityRole="button"
            accessibilityLabel={m.chat.fileReferenceOpenInSettings}
          >
            <Icon source="cog-outline" size={14} color={muted} />
            <Text style={[styles.copyText, { color: textColor }]}>{m.chat.fileReferenceOpenInSettings}</Text>
          </Pressable>
        ) : null}
        {refInfo.capabilities.includes('copyPath') ? (
          <Pressable
            style={({ pressed }) => [styles.copyButton, { borderColor: border }, pressed && styles.pressed]}
            onPress={copyPath}
            accessibilityRole="button"
            accessibilityLabel={m.chat.fileReferenceCopyPath}
          >
            <Icon source="content-copy" size={14} color={muted} />
            <Text style={[styles.copyText, { color: textColor }]}>{m.chat.fileReferenceCopyPath}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function buildShareRequest(rel: string, sessionKey?: string | null): ShareAutoRequest {
  return {
    path: rel,
    audience: 'friend',
    ...(sessionKey?.trim() ? { sessionKey: sessionKey.trim() } : {}),
  };
}

export function WorkspaceArtifactStrip({
  paths,
  sessionKey,
}: {
  paths: ExtractedFilePath[];
  sessionKey?: string | null;
}) {
  const { colors } = useTheme();
  const apiUrl = useGatewayStore((s) => s.apiUrl);
  const token = useGatewayStore((s) => s.token);
  const m = useMessages();
  const [resolved, setResolved] = useState<ResolvedArtifact[] | null>(null);
  const [active, setActive] = useState<PreviewableFile | null>(null);
  const [shareTarget, setShareTarget] = useState<ShareAutoRequest | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!paths.length) {
      setResolved([]);
      return;
    }
    setResolved(null);
    void (async () => {
      const next: ResolvedArtifact[] = [];
      for (const p of paths) {
        const refInfo = await resolveWorkspaceFileReference(p.workspaceRelativePath || p.absolutePath, {
          sessionKey,
        });
        if (refInfo) {
          next.push({ ...p, refInfo });
        }
      }
      if (!cancelled) setResolved(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [paths, sessionKey]);

  const visible = resolved ?? [];
  const workspacePaths = useMemo(
    () =>
      visible
        .filter((p) => p.refInfo.scope === 'workspace' && Boolean(p.refInfo.workspaceRelativePath))
        .map((p) => ({ ...p, rel: normalizeRel(p.refInfo.workspaceRelativePath!) })),
    [visible],
  );

  const imagePaths = useMemo(() => workspacePaths.filter((p) => isImageMimeType(p.mimeType)), [workspacePaths]);
  const otherPaths = useMemo(() => workspacePaths.filter((p) => !isImageMimeType(p.mimeType)), [workspacePaths]);
  const nonWorkspacePaths = useMemo(() => visible.filter((p) => p.refInfo.scope !== 'workspace'), [visible]);

  if (!paths.length || resolved === null || visible.length === 0) return null;

  const border = colors.border.default;
  const chipBg = colors.surface.input;
  const textColor = colors.text.primary;
  const muted = colors.text.secondary;
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

  return (
    <>
      <View style={styles.wrap}>
        {imagePaths.map((p, index) => (
          <View key={artifactRowKey(p, index)} style={[styles.thumb, { borderColor: border }]}>
            <Pressable
              style={({ pressed }) => [styles.thumbFill, pressed && styles.pressed]}
              onPress={() => setActive(toPreviewable(p))}
              accessibilityRole="button"
              accessibilityLabel={t(m.chat.previewFile, { name: p.fileName })}
            >
              <Image
                source={{ uri: apiUrl(rawPath(p.rel, sessionKey)), headers }}
                style={styles.thumbImage}
                resizeMode="cover"
              />
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.thumbShareBadge,
                { backgroundColor: colors.accent.primary },
                pressed && styles.pressed,
              ]}
              onPress={() => setShareTarget(buildShareRequest(p.rel, sessionKey))}
              accessibilityRole="button"
              accessibilityLabel={m.chat.shareFile}
              hitSlop={6}
            >
              <Icon source="share-variant" size={14} color={colors.accent.onPrimary} />
            </Pressable>
          </View>
        ))}
        {otherPaths.map((p, index) => (
          <View
            key={artifactRowKey(p, index)}
            style={[styles.chip, { borderColor: border, backgroundColor: chipBg }]}
          >
            <Pressable
              style={({ pressed }) => [styles.chipBody, pressed && styles.pressed]}
              onPress={() => setActive(toPreviewable(p))}
              accessibilityRole="button"
              accessibilityLabel={t(m.chat.previewFile, { name: p.fileName })}
            >
              <Icon source="file-outline" size={16} color={muted} />
              <Text style={[styles.chipText, { color: textColor }]} numberOfLines={1}>{p.fileName}</Text>
              <Icon source="eye-outline" size={14} color={muted} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.chipShareButton, pressed && styles.pressed]}
              onPress={() => setShareTarget(buildShareRequest(p.rel, sessionKey))}
              accessibilityRole="button"
              accessibilityLabel={m.chat.shareFile}
              hitSlop={6}
            >
              <Icon source="share-variant" size={14} color={muted} />
            </Pressable>
          </View>
        ))}
        {nonWorkspacePaths.map((p, index) => (
          <OffWorkspaceArtifactCard
            key={artifactRowKey(p, index)}
            path={p}
            refInfo={p.refInfo}
            border={border}
            chipBg={chipBg}
            textColor={textColor}
            muted={muted}
            warning={colors.semantic.warning}
          />
        ))}
      </View>
      <FilePreviewModal
        visible={Boolean(active)}
        file={active}
        sessionKey={sessionKey}
        onClose={() => setActive(null)}
      />
      <ShareSheet
        visible={Boolean(shareTarget)}
        request={shareTarget}
        onClose={() => setShareTarget(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  thumb: {
    width: 80,
    height: 80,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  thumbFill: {
    width: '100%',
    height: '100%',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbShareBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    maxWidth: '100%',
    minHeight: 34,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingLeft: 10,
    paddingRight: 4,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  chipBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    paddingVertical: 3,
  },
  chipShareButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '500',
  },
  externalCard: {
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 7,
  },
  externalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  externalTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  badge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    fontSize: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  externalDescription: {
    fontSize: 11,
    lineHeight: 16,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  copyButton: {
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  copyText: {
    fontSize: 11,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.72,
  },
});

import { useEffect, useMemo, useState } from 'react';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { ActivityIndicator, IconButton, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ShareAutoRequest } from '../../api/share';
import { TOAST_DURATION_SHORT } from '../../constants/toast';
import { t, useMessages } from '../../i18n/messages';
import { fetchFileContent } from '../../query/files';
import { useGatewayStore } from '../../stores/gateway-store';
import { spacing, useTheme } from '../../theme';
import { ShareSheet } from '../share/ShareSheet';
import { HtmlPreviewPane } from './HtmlPreviewPane';
import { isHtmlFile } from './html-preview-source';
import { MarkdownView } from './MarkdownView';
import { mimeTypeFromFileName } from './tool-result-file-paths';

export type PreviewableFile = {
  fileId?: string;
  name: string;
  mimeType?: string;
  /** Base64 binary payload, without data URI prefix. */
  contentBase64?: string;
  /** Plain text payload. */
  textContent?: string;
  /** Display-only path for managed files. */
  workspaceRelativePath?: string;
  /** Remote HTTP(S) URI to load on demand (e.g. gateway inbound file). */
  remoteUri?: string;
  /** Gateway media reads require the configured bearer token. */
  remoteRequiresAuth?: boolean;
  /** Optional extracted text fallback for documents. */
  extractedText?: string;
};

export type FilePreviewModalProps = {
  visible: boolean;
  file: PreviewableFile | null;
  onClose: () => void;
};

type PreviewKind = 'image' | 'markdown' | 'html' | 'text' | 'binary';

type LoadedPreview = {
  kind: PreviewKind;
  mimeType: string;
  text: string | null;
  base64: string | null;
};

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

function fileName(pathOrName: string): string {
  const parts = pathOrName.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? pathOrName;
}

function isImageFile(name: string, mimeType: string): boolean {
  const ext = extensionOf(name);
  return mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext);
}

function isMarkdownFile(name: string, mimeType: string): boolean {
  const ext = extensionOf(name);
  return ext === 'md' || ext === 'markdown' || mimeType === 'text/markdown';
}

function isTextFile(name: string, mimeType: string): boolean {
  if (isHtmlFile(name, mimeType)) return false;
  const ext = extensionOf(name);
  if (mimeType.startsWith('text/')) return true;
  return ['txt', 'json', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'xml', 'csv'].includes(ext);
}

function normalizeBase64Payload(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const m = value.match(/^data:[^;]+;base64,([\s\S]+)$/i);
  return (m?.[1] ?? value).replace(/\s/g, '');
}

function dataUri(mimeType: string, base64: string): string {
  return `data:${mimeType || 'application/octet-stream'};base64,${base64}`;
}

async function loadPreview(
  file: PreviewableFile,
): Promise<LoadedPreview> {
  const name = file.name || fileName(file.workspaceRelativePath ?? 'preview');
  const mimeType = file.mimeType || mimeTypeFromFileName(name);
  const kind: PreviewKind = isImageFile(name, mimeType)
    ? 'image'
    : isMarkdownFile(name, mimeType)
      ? 'markdown'
      : isHtmlFile(name, mimeType)
        ? 'html'
        : isTextFile(name, mimeType)
          ? 'text'
          : 'binary';

  if (file.fileId) {
    const response = await fetchFileContent(file.fileId);
    if (kind === 'image') {
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return { kind, mimeType, text: null, base64: globalThis.btoa(binary) };
    }
    if (kind === 'markdown' || kind === 'html' || kind === 'text') {
      return { kind, mimeType, text: await response.text(), base64: null };
    }
    return { kind: 'binary', mimeType, text: null, base64: null };
  }

  if (file.remoteUri) {
    const token = file.remoteRequiresAuth ? useGatewayStore.getState().accessToken : undefined;
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    const response = await fetch(file.remoteUri, headers ? { headers } : undefined);
    if (!response.ok) throw new Error(`Failed to load file (${response.status})`);
    if (kind === 'image') {
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return { kind, mimeType, text: null, base64: globalThis.btoa(binary) };
    }
    if (kind === 'markdown' || kind === 'html' || kind === 'text') {
      return { kind, mimeType, text: await response.text(), base64: null };
    }
    return { kind: 'binary', mimeType, text: null, base64: null };
  }

  if (kind === 'image') {
    const direct = normalizeBase64Payload(file.contentBase64);
    if (direct) return { kind, mimeType, text: null, base64: direct };
    return { kind, mimeType, text: null, base64: null };
  }

  if (kind === 'html') {
    if (file.textContent != null) {
      return { kind, mimeType, text: file.textContent, base64: null };
    }
    const fromBase64 = normalizeBase64Payload(file.contentBase64);
    if (fromBase64) {
      try {
        return { kind, mimeType, text: globalThis.atob(fromBase64), base64: null };
      } catch {
        return { kind, mimeType, text: null, base64: null };
      }
    }
  }

  if (kind === 'markdown' || kind === 'text') {
    if (file.textContent != null) {
      return { kind, mimeType, text: file.textContent, base64: null };
    }
    const fromBase64 = normalizeBase64Payload(file.contentBase64);
    if (fromBase64) {
      try {
        return { kind, mimeType, text: globalThis.atob(fromBase64), base64: null };
      } catch {
        return { kind, mimeType, text: null, base64: null };
      }
    }
  }

  return {
    kind: 'binary',
    mimeType,
    text: file.extractedText ?? null,
    base64: normalizeBase64Payload(file.contentBase64),
  };
}

function buildDownloadUrlForFile(
  file: PreviewableFile,
): string | null {
  return file.remoteUri ?? null;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function FilePreviewModal({ visible, file, onClose }: FilePreviewModalProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const m = useMessages();
  const cm = m.chat;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedPreview | null>(null);
  const [shareTarget, setShareTarget] = useState<ShareAutoRequest | null>(null);
  const [downloadPending, setDownloadPending] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  const title = useMemo(() => (file ? file.name || fileName(file.workspaceRelativePath ?? 'Preview') : ''), [file]);

  useEffect(() => {
    let cancelled = false;
    setShareTarget(null);
    setError(null);
    setDownloadError('');
    setLoaded(null);
    if (!visible || !file) return;
    setLoading(true);
    void loadPreview(file)
      .then((next) => {
        if (!cancelled) setLoaded(next);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file, visible]);

  useEffect(() => {
    if (!downloadError) return;
    const timer = setTimeout(() => setDownloadError(''), TOAST_DURATION_SHORT);
    return () => clearTimeout(timer);
  }, [downloadError]);

  const canDownload = Boolean(file?.fileId || file?.remoteUri);
  const downloadFile = async () => {
    if (!file) return;
    setDownloadError('');
    setDownloadPending(true);
    try {
      if (file.fileId || (file.remoteUri && file.remoteRequiresAuth)) {
        if (!(await Sharing.isAvailableAsync())) throw new Error(cm.filePreviewShareUnavailable);
        const accessToken = useGatewayStore.getState().accessToken;
        const response = file.fileId
          ? await fetchFileContent(file.fileId)
          : await fetch(file.remoteUri!, {
              headers: accessToken
                ? { Authorization: `Bearer ${accessToken}` }
                : undefined,
            });
        if (!response.ok) throw new Error(`Failed to download file (${response.status})`);
        const directory = new Directory(Paths.cache, 'file-share', `${Date.now()}`);
        directory.create({ intermediates: true });
        try {
          const localFile = new File(directory, file.name || 'file');
          localFile.create();
          localFile.write(new Uint8Array(await response.arrayBuffer()));
          await Sharing.shareAsync(localFile.uri, { mimeType: file.mimeType, dialogTitle: cm.shareFile });
        } finally {
          try { directory.delete(); } catch { /* Sharing already completed. */ }
        }
        return;
      }
      const remoteUrl = buildDownloadUrlForFile(file);
      if (remoteUrl) {
        await Linking.openURL(remoteUrl);
        return;
      }
    } catch (e) {
      setDownloadError(t(cm.filePreviewDownloadFailed, { message: errorMessage(e) }));
    } finally {
      setDownloadPending(false);
    }
  };

  const surface = colors.surface.base;
  const textColor = colors.text.primary;
  const muted = colors.text.secondary;
  const border = colors.border.default;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: surface, paddingTop: insets.top }]}> 
        <View style={[styles.header, { borderBottomColor: border }]}> 
          <Text variant="titleMedium" numberOfLines={1} style={[styles.title, { color: textColor }]}> 
            {title}
          </Text>
          {canDownload ? (
            <IconButton
              icon="download-outline"
              size={20}
              iconColor={textColor}
              onPress={downloadFile}
              accessibilityLabel={m.chat.filePreviewDownload}
              disabled={downloadPending}
            />
          ) : null}
          {file?.fileId ? (
            <IconButton
              icon="share-variant"
              size={spacing.content}
              iconColor={textColor}
              onPress={() => setShareTarget({ fileId: file.fileId!, audience: 'friend' })}
              accessibilityLabel={cm.shareFile}
              style={styles.shareButton}
            />
          ) : null}
          <IconButton icon="close" size={22} iconColor={textColor} onPress={onClose} accessibilityLabel={cm.filePreviewClose} />
        </View>

        {downloadError ? (
          <View
            style={[
              styles.downloadErrorBanner,
              { borderBottomColor: colors.border.default, backgroundColor: colors.surface.panel },
            ]}
          >
            <Text style={[styles.downloadErrorText, { color: colors.semantic.errorBold }]} numberOfLines={3}>
              {downloadError}
            </Text>
          </View>
        ) : null}

        <View style={styles.body}>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator />
              <Text style={{ color: muted }}>{cm.filePreviewLoading}</Text>
            </View>
          ) : error ? (
            <View style={styles.center}>
              <Text style={[styles.error, { color: colors.semantic.errorBold }]}>
                {t(cm.filePreviewLoadFailed, { message: error })}
              </Text>
            </View>
          ) : loaded?.kind === 'image' && loaded.base64 ? (
            <ScrollView
              contentContainerStyle={styles.imageScroller}
              maximumZoomScale={4}
              minimumZoomScale={1}
              bouncesZoom
            >
              <Image source={{ uri: dataUri(loaded.mimeType, loaded.base64) }} style={styles.image} resizeMode="contain" />
            </ScrollView>
          ) : loaded?.kind === 'markdown' && loaded.text != null ? (
            <ScrollView contentContainerStyle={styles.textContent}>
              <MarkdownView content={loaded.text} />
            </ScrollView>
          ) : loaded?.kind === 'html' ? (
            <HtmlPreviewPane
              htmlContent={loaded.text}
              mutedColor={muted}
            />
          ) : loaded?.kind === 'text' && loaded.text != null ? (
            <ScrollView contentContainerStyle={styles.textContent}>
              <Text selectable style={[styles.mono, { color: textColor }]}> 
                {loaded.text}
              </Text>
            </ScrollView>
          ) : loaded?.kind === 'binary' && loaded.text ? (
            <ScrollView contentContainerStyle={styles.textContent}>
              <Text style={[styles.notice, { color: muted }]}>{cm.filePreviewUnsupportedWithText}</Text>
              <Text selectable style={[styles.mono, { color: textColor }]}> 
                {loaded.text}
              </Text>
            </ScrollView>
          ) : (
            <View style={styles.center}>
              <Text style={[styles.notice, { color: muted }]}>{cm.filePreviewUnsupported}</Text>
              <Pressable style={[styles.closeButton, { borderColor: border }]} onPress={onClose} accessibilityRole="button">
                <Text style={{ color: textColor }}>{m.common.close}</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
      <ShareSheet
        visible={visible && Boolean(shareTarget)}
        request={shareTarget}
        onClose={() => setShareTarget(null)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingLeft: 16,
  },
  title: {
    flex: 1,
    fontWeight: '600',
  },
  shareButton: {
    minWidth: spacing.xxxl,
    minHeight: spacing.xxxl,
  },
  body: {
    flex: 1,
  },
  downloadErrorBanner: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  downloadErrorText: {
    fontSize: 13,
    lineHeight: 18,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 28,
  },
  imageScroller: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  image: {
    width: '100%',
    minHeight: 360,
  },
  textContent: {
    padding: 16,
  },
  mono: {
    fontSize: 13,
    lineHeight: 20,
    fontFamily: 'Menlo',
  },
  notice: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  error: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  closeButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
});

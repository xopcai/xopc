import { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { t, useMessages } from '../../i18n/messages';
import { useGatewayStore } from '../../stores/gateway-store';
import { useTheme } from '../../theme';
import { AudioMessageBlock } from './AudioMessageBlock';
import { FilePreviewModal, type PreviewableFile } from './FilePreviewModal';
import { buildGatewayRawFilePath } from './image-source-utils';
import { buildGatewayMediaReadPath, isMediaUri } from './media-uri';
import type { AudioContent, MessageAttachment } from './messages.types';
import { mimeTypeFromFileName } from './tool-result-file-paths';

function isImageAttachment(att: MessageAttachment): boolean {
  return att.type === 'image' || att.mimeType?.startsWith('image/') === true;
}

function isAudioAttachment(att: MessageAttachment): boolean {
  return att.type === 'voice' || att.type === 'audio' || att.mimeType?.startsWith('audio/') === true;
}

function attachmentName(att: MessageAttachment, index: number): string {
  return att.name?.trim() || att.workspaceRelativePath?.split('/').filter(Boolean).pop() || `attachment-${index + 1}`;
}

function attachmentPayload(att: MessageAttachment): string | undefined {
  return att.preview || att.content || att.data;
}

function attachmentToPreviewable(
  att: MessageAttachment,
  index: number,
  sessionKey?: string | null,
): PreviewableFile {
  const name = attachmentName(att, index);
  return {
    name,
    mimeType: att.mimeType || mimeTypeFromFileName(name),
    contentBase64: attachmentPayload(att),
    workspaceRelativePath: att.workspaceRelativePath,
    remoteUri: isMediaUri(att.uri) ? useGatewayStore.getState().apiUrl(buildGatewayMediaReadPath(att.uri, sessionKey)) : undefined,
    extractedText: att.extractedText,
  };
}

function imageSource(
  att: MessageAttachment,
  sessionKey: string | null | undefined,
  apiUrl: (path: string) => string,
  token: string,
): { uri: string; headers?: Record<string, string> } | null {
  const payload = attachmentPayload(att)?.trim();
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  if (payload) {
    if (payload.startsWith('data:')) return { uri: payload };
    const mime = att.mimeType || 'image/png';
    return { uri: `data:${mime};base64,${payload.replace(/\s/g, '')}` };
  }
  if (isMediaUri(att.uri)) {
    return { uri: apiUrl(buildGatewayMediaReadPath(att.uri, sessionKey)), headers };
  }
  const rel = att.workspaceRelativePath?.replace(/^\/+/, '').trim();
  if (rel) {
    return { uri: apiUrl(buildGatewayRawFilePath(rel, sessionKey ?? undefined)), headers };
  }
  return null;
}

function attachmentToAudioContent(att: MessageAttachment): AudioContent {
  const payload = attachmentPayload(att)?.trim();
  const mimeType = att.mimeType || 'audio/mpeg';
  return {
    type: 'audio',
    workspaceRelativePath: att.workspaceRelativePath,
    uri: att.uri ?? (
      payload && !att.workspaceRelativePath
        ? payload.startsWith('data:') || payload.startsWith('file:')
          ? payload
          : `data:${mimeType};base64,${payload.replace(/\s/g, '')}`
        : undefined
    ),
    mimeType,
    name: att.name,
    durationSeconds: att.durationSeconds,
  };
}

export function AttachmentRenderer({
  attachments,
  sessionKey,
  compact = false,
}: {
  attachments?: MessageAttachment[];
  sessionKey?: string | null;
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const m = useMessages();
  const apiUrl = useGatewayStore((s) => s.apiUrl);
  const token = useGatewayStore((s) => s.token);
  const [active, setActive] = useState<PreviewableFile | null>(null);
  const items = useMemo(() => attachments?.filter(Boolean) ?? [], [attachments]);
  const audioItems = useMemo(() => items.filter(isAudioAttachment), [items]);
  const nonAudioItems = useMemo(
    () => items.filter((att) => !isAudioAttachment(att)),
    [items],
  );
  if (!items.length) return null;

  const border = colors.border.default;
  const chipBg = colors.surface.input;
  const textColor = colors.text.primary;
  const muted = colors.text.secondary;

  return (
    <>
      {audioItems.length > 0 ? (
        <View style={[styles.audioWrap, compact && styles.wrapCompact]}>
          {audioItems.map((att, index) => (
            <AudioMessageBlock
              key={att.id ?? `${attachmentName(att, index)}-${index}`}
              audio={attachmentToAudioContent(att)}
              sessionKey={sessionKey}
            />
          ))}
        </View>
      ) : null}
      {nonAudioItems.length > 0 ? (
      <View style={[styles.wrap, compact && styles.wrapCompact]}>
        {nonAudioItems.map((att, index) => {
          const name = attachmentName(att, index);
          const preview = attachmentToPreviewable(att, index, sessionKey);
          const source = isImageAttachment(att) ? imageSource(att, sessionKey, apiUrl, token) : null;
          if (source) {
            return (
              <Pressable
                key={att.id ?? `${name}-${index}`}
                style={({ pressed }) => [styles.imageTile, { borderColor: border }, pressed && styles.pressed]}
                onPress={() => setActive(preview)}
                accessibilityRole="button"
                accessibilityLabel={t(m.chat.previewFile, { name })}
              >
                <Image source={source} style={styles.image} resizeMode="cover" />
              </Pressable>
            );
          }
          return (
            <Pressable
              key={att.id ?? `${name}-${index}`}
              style={({ pressed }) => [styles.chip, { borderColor: border, backgroundColor: chipBg }, pressed && styles.pressed]}
              onPress={() => setActive(preview)}
              accessibilityRole="button"
              accessibilityLabel={t(m.chat.previewFile, { name })}
            >
              <Icon source="file-outline" size={16} color={muted} />
              <Text style={[styles.chipText, { color: textColor }]} numberOfLines={1}>{name}</Text>
              <Icon source="eye-outline" size={14} color={muted} />
            </Pressable>
          );
        })}
      </View>
      ) : null}
      <FilePreviewModal
        visible={Boolean(active)}
        file={active}
        sessionKey={sessionKey}
        onClose={() => setActive(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  audioWrap: {
    gap: 8,
    marginTop: 4,
    alignItems: 'flex-end',
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  wrapCompact: {
    marginTop: 0,
  },
  imageTile: {
    width: 96,
    height: 96,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  chip: {
    maxWidth: '100%',
    minHeight: 36,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '500',
  },
  pressed: {
    opacity: 0.72,
  },
});

import { useQuery } from '@tanstack/react-query';
import type { FileResource } from '@xopcai/gateway-contract';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { t, useMessages } from '../../i18n/messages';
import { fileContentPath, resolveContextFileResources } from '../../query/files';
import { useGatewayStore } from '../../stores/gateway-store';
import { spacing, useTheme } from '../../theme';
import { AudioMessageBlock } from './AudioMessageBlock';
import { artifactFileId } from './artifact-uri';
import { CompactResourceList } from './CompactResourceList';
import { FilePreviewModal, type PreviewableFile } from '../file-preview/FilePreviewModal';
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

function attachmentRemoteUri(att: MessageAttachment, conversationId?: string | null): string | undefined {
  if (isMediaUri(att.uri)) {
    return useGatewayStore.getState().apiUrl(buildGatewayMediaReadPath(att.uri, conversationId));
  }
  return /^https?:\/\//i.test(att.uri ?? '') ? att.uri : undefined;
}

function attachmentToPreviewable(
  att: MessageAttachment,
  index: number,
  resource: FileResource | null,
  conversationId?: string | null,
): PreviewableFile {
  const name = attachmentName(att, index);
  const fileId = artifactFileId(att.uri);
  return {
    name,
    fileId: fileId ?? resource?.id,
    mimeType: resource?.mimeType || att.mimeType || mimeTypeFromFileName(name),
    contentBase64: attachmentPayload(att),
    workspaceRelativePath: att.workspaceRelativePath,
    remoteUri: attachmentRemoteUri(att, conversationId),
    remoteRequiresAuth: isMediaUri(att.uri),
    extractedText: att.extractedText,
  };
}

function attachmentToAudioContent(
  att: MessageAttachment,
  resource: FileResource | null,
  apiUrl: (path: string) => string,
): AudioContent {
  const payload = attachmentPayload(att)?.trim();
  const mimeType = att.mimeType || 'audio/mpeg';
  const fileId = artifactFileId(att.uri);
  return {
    type: 'audio',
    workspaceRelativePath: att.workspaceRelativePath,
    uri: fileId ? att.uri : resource ? apiUrl(fileContentPath(resource.id)) : att.uri ?? (
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
  conversationId,
}: {
  attachments?: MessageAttachment[];
  conversationId?: string | null;
}) {
  const { colors } = useTheme();
  const m = useMessages();
  const apiUrl = useGatewayStore((s) => s.apiUrl);
  const [active, setActive] = useState<PreviewableFile | null>(null);
  const items = useMemo(() => attachments?.filter(Boolean) ?? [], [attachments]);
  const workspacePaths = useMemo(
    () => items.map((item) => artifactFileId(item.uri) ? undefined : item.workspaceRelativePath),
    [items],
  );
  const resourcesQuery = useQuery({
    queryKey: ['files', 'message-attachments', conversationId ?? '', workspacePaths],
    queryFn: () => resolveContextFileResources('session', conversationId!, workspacePaths),
    enabled: Boolean(conversationId && workspacePaths.some(Boolean)),
    staleTime: 30_000,
  });
  const resourceByItem = resourcesQuery.data ?? [];
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
        <View style={styles.audioWrap}>
          {audioItems.map((att, index) => {
            const itemIndex = items.indexOf(att);
            return (
              <AudioMessageBlock
                key={att.id ?? `${attachmentName(att, index)}-${index}`}
                audio={attachmentToAudioContent(att, resourceByItem[itemIndex] ?? null, apiUrl)}
              />
            );
          })}
        </View>
      ) : null}
      {nonAudioItems.length > 0 ? (
        <CompactResourceList
          items={nonAudioItems}
          title={m.chat.attachmentsHeading}
          moreLabel={(count) => m.chat.moreAttachments.replace('{{count}}', String(count))}
          keyExtractor={(att, index) => att.id ?? `${attachmentName(att, index)}-${index}`}
          renderItem={(att, index, requestAction) => {
            const name = attachmentName(att, index);
            const itemIndex = items.indexOf(att);
            const preview = attachmentToPreviewable(
              att,
              index,
              resourceByItem[itemIndex] ?? null,
              conversationId,
            );
            return (
              <Pressable
                style={({ pressed }) => [
                  styles.resourceRow,
                  { borderColor: border, backgroundColor: pressed ? colors.surface.pressed : chipBg },
                ]}
                onPress={() => requestAction(() => setActive(preview))}
                accessibilityRole="button"
                accessibilityLabel={t(m.chat.previewFile, { name })}
              >
                <Icon source={isImageAttachment(att) ? 'image-outline' : 'file-outline'} size={18} color={muted} />
                <Text style={[styles.resourceTitle, { color: textColor }]} numberOfLines={1}>
                  {name}
                </Text>
                <Icon source="chevron-right" size={18} color={muted} />
              </Pressable>
            );
          }}
        />
      ) : null}
      <FilePreviewModal
        visible={Boolean(active)}
        file={active}
        conversationId={conversationId}
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
  resourceRow: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  resourceTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '600',
  },
});

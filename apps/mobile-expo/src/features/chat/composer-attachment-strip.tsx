import { GatewayImage as Image } from '../../components/GatewayImage';
import { memo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { radii, spacing, typography, useTheme } from '../../theme';
import { isEditableImageAttachment } from './attachment-file-io-core';
import { AudioMessageBlock } from './AudioMessageBlock';
import type { ComposerAttachment } from './composer.types';
import { FilePreviewModal, type PreviewableFile } from '../file-preview/FilePreviewModal';
import { ImageEditorModal } from './ImageEditorModal';
import type { AudioContent } from './messages.types';

function isAudioAttachment(att: ComposerAttachment): boolean {
  return att.mimeType.startsWith('audio/');
}

function isImageAttachment(att: ComposerAttachment): boolean {
  return att.type === 'image' || att.mimeType.startsWith('image/');
}

function attachmentToPreviewable(att: ComposerAttachment): PreviewableFile {
  const isImage = isImageAttachment(att);
  return {
    name: att.name,
    mimeType: att.mimeType,
    ...(att.workspaceRelativePath ? { fileId: att.id, workspaceRelativePath: att.workspaceRelativePath } : { contentBase64: att.content }),
    remoteUri: isImage && !att.content && att.localUri ? att.localUri : undefined,
  };
}

function attachmentToAudioContent(att: ComposerAttachment): AudioContent {
  let uri: string | undefined;
  if (att.localUri) {
    uri = att.localUri;
  } else if (att.content) {
    uri = `data:${att.mimeType};base64,${att.content}`;
  }
  return {
    type: 'audio',
    uri,
    mimeType: att.mimeType,
    name: att.name,
  };
}

function thumbnailUri(att: ComposerAttachment): string | null {
  if (!isImageAttachment(att)) return null;
  if (att.localUri) return att.localUri;
  if (att.content) {
    return `data:${att.mimeType};base64,${att.content}`;
  }
  return null;
}

export const ComposerAttachmentStrip = memo(function ComposerAttachmentStrip({
  attachments,
  onRemove,
  onReplace,
  removeLabel,
  editLabel,
}: {
  attachments: ComposerAttachment[];
  onRemove: (index: number) => void;
  onReplace?: (index: number, attachment: ComposerAttachment) => void;
  removeLabel: string;
  editLabel?: string;
}) {
  const { colors } = useTheme();
  const [preview, setPreview] = useState<PreviewableFile | null>(null);
  const [audioPreview, setAudioPreview] = useState<AudioContent | null>(null);
  const [editing, setEditing] = useState<{ index: number; attachment: ComposerAttachment } | null>(null);
  const border = colors.border.default;
  const chipBg = colors.surface.input;
  const muted = colors.text.secondary;

  const items = attachments;
  if (!items.length) return null;

  return (
    <>
      {items.map((att, index) => {
        const uri = thumbnailUri(att);
        const audio = isAudioAttachment(att);
        return (
          <View key={att.id} style={[styles.chip, { backgroundColor: chipBg }]}>
            <Pressable style={styles.open}
              onPress={() => {
                if (audio && !att.workspaceRelativePath) {
                  setAudioPreview(attachmentToAudioContent(att));
                  return;
                }
                setPreview(attachmentToPreviewable(att));
              }} accessibilityRole="button" accessibilityLabel={att.name}>
              {uri ? <Image source={{ uri }} style={styles.thumbnail} resizeMode="cover" />
                : <Icon source={audio ? 'microphone' : 'file-outline'} size={16} color={muted} />}
              <Text numberOfLines={1} style={[styles.label, { color: colors.text.primary }]}>{att.name}</Text>
            </Pressable>
            {onReplace && editLabel && isEditableImageAttachment(att) ? (
              <Pressable style={styles.action} onPress={() => setEditing({ index, attachment: att })}
                accessibilityRole="button" accessibilityLabel={`${editLabel}: ${att.name}`}>
                <Icon source="pencil-outline" size={16} color={muted} />
              </Pressable>
            ) : null}
            <Pressable style={styles.action} onPress={() => onRemove(index)}
              accessibilityRole="button" accessibilityLabel={`${removeLabel}: ${att.name}`}>
              <Icon source="close" size={14} color={muted} />
            </Pressable>
          </View>
        );
      })}
      <ImageEditorModal
        visible={Boolean(editing)}
        attachment={editing?.attachment ?? null}
        onClose={() => setEditing(null)}
        onSave={(next) => {
          if (editing) onReplace?.(editing.index, next);
          setEditing(null);
        }}
      />
      <FilePreviewModal visible={Boolean(preview)} file={preview} onClose={() => setPreview(null)} />
      <Modal
        visible={Boolean(audioPreview)}
        animationType="none"
        transparent
        onRequestClose={() => setAudioPreview(null)}
      >
        <Pressable
          style={[styles.audioBackdrop, { backgroundColor: colors.overlay.scrim }]}
          onPress={() => setAudioPreview(null)}
        >
          <Pressable style={[styles.audioSheet, { backgroundColor: chipBg, borderColor: border }]} onPress={() => {}}>
            {audioPreview ? <AudioMessageBlock audio={audioPreview} /> : null}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
});

const styles = StyleSheet.create({
  chip: { minHeight: 44, maxWidth: 240, flexShrink: 0, flexDirection: 'row', alignItems: 'center', borderRadius: radii.full, paddingLeft: spacing.sm },
  open: { minHeight: 44, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  thumbnail: { width: spacing.xxl, height: spacing.xxl, borderRadius: radii.sm },
  label: { ...typography.caption, flexShrink: 1 },
  action: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  audioBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  audioSheet: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
});

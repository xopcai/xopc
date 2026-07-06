import { memo, useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { useGatewayStore } from '../../stores/gateway-store';
import { useTheme } from '../../theme';
import { AudioMessageBlock } from './AudioMessageBlock';
import type { ComposerAttachment } from './composer.types';
import { FilePreviewModal, type PreviewableFile } from './FilePreviewModal';
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
    contentBase64: att.content,
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

function needsAuthHeaders(uri: string): boolean {
  return uri.startsWith('http://') || uri.startsWith('https://');
}

export const ComposerAttachmentStrip = memo(function ComposerAttachmentStrip({
  attachments,
  onRemove,
  removeLabel,
  readOnly = false,
}: {
  attachments: ComposerAttachment[];
  onRemove: (index: number) => void;
  removeLabel: string;
  readOnly?: boolean;
}) {
  const { colors } = useTheme();
  const token = useGatewayStore((s) => s.token);
  const [preview, setPreview] = useState<PreviewableFile | null>(null);
  const [audioPreview, setAudioPreview] = useState<AudioContent | null>(null);
  const border = colors.border.default;
  const chipBg = colors.surface.input;
  const muted = colors.text.secondary;
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;

  const items = useMemo(() => attachments.filter(Boolean), [attachments]);
  if (!items.length) return null;

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {items.map((att, index) => {
          const uri = thumbnailUri(att);
          const audio = isAudioAttachment(att);
          return (
            <View key={att.id} style={[styles.tileWrap, { borderColor: border }]}>
              <Pressable
                style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
                onPress={() => {
                  if (audio) {
                    setAudioPreview(attachmentToAudioContent(att));
                    return;
                  }
                  setPreview(attachmentToPreviewable(att));
                }}
                accessibilityRole="button"
                accessibilityLabel={att.name}
              >
                {uri ? (
                  <Image
                    source={{
                      uri,
                      ...(needsAuthHeaders(uri) && authHeaders ? { headers: authHeaders } : {}),
                    }}
                    style={styles.image}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={[styles.docTile, { backgroundColor: chipBg }]}>
                    <Icon source={audio ? 'microphone' : 'file-outline'} size={28} color={muted} />
                    <Text style={[styles.docName, { color: muted }]} numberOfLines={2}>
                      {att.name}
                    </Text>
                  </View>
                )}
              </Pressable>
              {!readOnly ? (
                <Pressable
                  style={styles.removeHit}
                  onPress={() => onRemove(index)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={removeLabel}
                >
                  <View style={[styles.removeBadge, { backgroundColor: colors.text.primary }]}>
                    <Icon source="close" size={14} color={colors.text.inverse} />
                  </View>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
      <FilePreviewModal visible={Boolean(preview)} file={preview} onClose={() => setPreview(null)} />
      <Modal
        visible={Boolean(audioPreview)}
        animationType="fade"
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

const TILE = 72;

const styles = StyleSheet.create({
  scroll: {
    maxHeight: TILE + 16,
  },
  scrollContent: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 8,
  },
  tileWrap: {
    width: TILE,
    height: TILE,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'visible',
  },
  tile: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  docTile: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
    gap: 4,
  },
  docName: {
    fontSize: 10,
    textAlign: 'center',
  },
  removeHit: {
    position: 'absolute',
    top: -6,
    right: -6,
    zIndex: 2,
  },
  removeBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.85,
  },
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

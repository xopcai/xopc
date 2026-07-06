import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { MAX_PENDING_FOLLOW_UPS, type PendingFollowUp } from './pending-follow-up.types';
import { useMessages } from '../../i18n/messages';
import { useTheme } from '../../theme';

export const ChatPendingFollowUpStack = memo(function ChatPendingFollowUpStack({
  items,
  disabled,
  editingFollowUpId,
  onEditInComposer,
  onRemove,
  onMove,
  onSteer,
  steeringBusyId,
}: {
  items: PendingFollowUp[];
  disabled?: boolean;
  editingFollowUpId?: string | null;
  onEditInComposer: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: 'up' | 'down') => void;
  onSteer: (id: string) => void;
  steeringBusyId?: string | null;
}) {
  const m = useMessages();
  const { colors } = useTheme();
  const muted = colors.text.secondary;
  const text = colors.text.primary;
  const accent = colors.accent.primary;

  if (items.length === 0) return null;

  return (
    <View
      style={styles.wrap}
      accessibilityRole="list"
      accessibilityLabel={m.chat.followUpQueueAria}
    >
      <View style={styles.header}>
        <Text style={[styles.heading, { color: muted }]}>{m.chat.followUpQueueHeading}</Text>
        <Text style={[styles.count, { color: muted }]}>
          {items.length}/{MAX_PENDING_FOLLOW_UPS}
        </Text>
      </View>
      {items.map((item, index) => {
        const canSteer = !item.attachments?.length && item.text.trim().length > 0;
        const isSteering = steeringBusyId === item.id;
        let preview = item.text.trim();
        if (!preview && item.attachments?.length) {
          const n0 = item.attachments[0]?.name?.trim();
          preview = n0 || m.chat.followUpQueueAttachmentOnly;
        }
        if (!preview) preview = m.chat.followUpQueueEmptyPreview;

        return (
          <View
            key={item.id}
            style={[
              styles.row,
              {
                borderColor: editingFollowUpId === item.id
                  ? colors.accent.primary
                  : colors.border.default,
                backgroundColor: editingFollowUpId === item.id
                  ? colors.accent.selectionBg
                  : colors.surface.input,
              },
            ]}
          >
            <Pressable
              disabled={disabled}
              style={styles.previewBtn}
              onPress={() => onEditInComposer(item.id)}
              accessibilityLabel={m.chat.followUpQueueClickToEdit}
            >
              {item.attachments?.length ? (
                <View style={styles.previewWithIcon}>
                  <Icon source="file-outline" size={14} color={muted} />
                  <Text style={[styles.previewText, { color: text }]} numberOfLines={1}>
                    {preview}
                  </Text>
                </View>
              ) : (
                <Text style={[styles.previewText, { color: text }]} numberOfLines={1}>
                  {preview}
                </Text>
              )}
            </Pressable>
            <View style={styles.actions}>
              <Pressable
                disabled={disabled || index === 0}
                onPress={() => onMove(item.id, 'up')}
                hitSlop={6}
                accessibilityLabel={m.chat.followUpQueueMoveUp}
              >
                <Icon source="chevron-up" size={18} color={disabled || index === 0 ? colors.text.disabled : muted} />
              </Pressable>
              <Pressable
                disabled={disabled || index >= items.length - 1}
                onPress={() => onMove(item.id, 'down')}
                hitSlop={6}
                accessibilityLabel={m.chat.followUpQueueMoveDown}
              >
                <Icon
                  source="chevron-down"
                  size={18}
                  color={disabled || index >= items.length - 1 ? colors.text.disabled : muted}
                />
              </Pressable>
              <Pressable
                disabled={disabled || !canSteer || isSteering}
                onPress={() => onSteer(item.id)}
                hitSlop={6}
                accessibilityLabel={m.chat.followUpQueueSteerNow}
              >
                <Icon
                  source="star-four-points-outline"
                  size={16}
                  color={disabled || !canSteer || isSteering ? colors.text.disabled : accent}
                />
              </Pressable>
              <Pressable
                disabled={disabled}
                onPress={() => onRemove(item.id)}
                hitSlop={6}
                accessibilityLabel={m.chat.followUpQueueRemove}
              >
                <Icon source="close" size={16} color={muted} />
              </Pressable>
            </View>
          </View>
        );
      })}
      {items.some((i) => i.attachments?.length) ? (
        <Text style={[styles.note, { color: muted }]}>{m.chat.followUpQueueAttachmentsNote}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 4,
    gap: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 2,
  },
  heading: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  count: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    minHeight: 34,
    paddingLeft: 8,
    paddingRight: 4,
  },
  previewBtn: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 6,
    paddingRight: 6,
  },
  previewWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 0,
  },
  previewText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  note: {
    fontSize: 11,
    lineHeight: 15,
    paddingHorizontal: 4,
    paddingTop: 2,
  },
});

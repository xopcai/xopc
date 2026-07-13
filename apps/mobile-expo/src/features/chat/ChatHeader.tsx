import { memo, useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import type { ChatModelOption } from '../../query/models';

import { ModelPickerMenu } from './ModelPickerMenu';

export const ChatHeader = memo(function ChatHeader({
  agentName,
  modelName,
  models,
  currentModelId,
  paddingTop,
  headerBg: _headerBg,
  pillText,
  pillMuted,
  onBackPress,
  onAgentPress,
  onModelSelect,
  onFilesPress,
  onNewChat,
}: {
  agentName: string;
  modelName: string;
  models: ChatModelOption[];
  currentModelId: string;
  paddingTop: number;
  headerBg: string;
  pillText: string;
  pillMuted: string;
  onBackPress?: () => void;
  onAgentPress: () => void;
  onModelSelect: (modelId: string) => void;
  onFilesPress?: () => void;
  onNewChat: () => void;
}) {
  const m = useMessages();
  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const pickerTopOffset = paddingTop + 52;

  const openModelPicker = useCallback(() => {
    setModelPickerVisible(true);
  }, []);

  const closeModelPicker = useCallback(() => {
    setModelPickerVisible(false);
  }, []);

  return (
    <>
      <View style={[styles.header, { paddingTop }]}> 
        {onBackPress ? (
          <Pressable style={styles.iconButton} onPress={onBackPress} hitSlop={6}>
            <Icon source="chevron-left" size={26} color={pillText} />
          </Pressable>
        ) : (
          <View style={styles.iconPlaceholder} />
        )}

        <View style={styles.headerCenter}>
          <Pressable
            style={styles.titlePressable}
            onPress={onAgentPress}
            accessibilityRole="button"
            accessibilityLabel={m.chat.headerAgentPicker}
          >
            <Text style={[styles.agentTitle, { color: pillText }]} numberOfLines={1}>
              {agentName}
            </Text>
          </Pressable>
          <Pressable
            style={styles.modelPressable}
            onPress={openModelPicker}
            accessibilityRole="button"
            accessibilityLabel={m.chat.headerModelPicker}
          >
            <Text style={[styles.modelTitle, { color: pillMuted }]} numberOfLines={1}>
              {modelName}
            </Text>
            <Icon source="chevron-down" size={16} color={pillMuted} />
          </Pressable>
        </View>

        <View style={styles.rightActions}>
          <Pressable style={styles.iconButton} onPress={onNewChat} hitSlop={6}>
            <Icon source="square-edit-outline" size={21} color={pillText} />
          </Pressable>
          {onFilesPress ? (
            <Pressable
              style={styles.iconButton}
              onPress={onFilesPress}
              accessibilityRole="button"
              accessibilityLabel={m.chat.openSessionFiles}
            >
              <Icon source="folder-outline" size={21} color={pillText} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ModelPickerMenu
        visible={modelPickerVisible}
        topOffset={pickerTopOffset}
        models={models}
        currentModelId={currentModelId}
        onSelect={onModelSelect}
        onDismiss={closeModelPicker}
      />
    </>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPlaceholder: {
    width: 44,
    height: 44,
  },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerCenter: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  titlePressable: {
    maxWidth: '100%',
    paddingHorizontal: 4,
  },
  modelPressable: {
    maxWidth: '100%',
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  agentTitle: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  modelTitle: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    flexShrink: 1,
  },
});

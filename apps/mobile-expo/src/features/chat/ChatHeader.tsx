import { memo, useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import type { ChatModelOption } from '../../query/models';

import { ChatActionsSheet } from './ChatActionsSheet';
import { ModelPickerMenu } from './ModelPickerMenu';

export const ChatHeader = memo(function ChatHeader({
  agentName,
  modelName,
  models,
  currentModelId,
  paddingTop,
  pillText,
  autoReadAloudEnabled,
  onBackPress,
  onAgentPress,
  onAutoReadAloudToggle,
  onModelSelect,
  onFilesPress,
  onNewChat,
}: {
  agentName: string;
  modelName: string;
  models: ChatModelOption[];
  currentModelId: string;
  paddingTop: number;
  pillText: string;
  autoReadAloudEnabled: boolean;
  onBackPress?: () => void;
  onAgentPress: () => void;
  onAutoReadAloudToggle: () => void;
  onModelSelect: (modelId: string) => void;
  onFilesPress?: () => void;
  onNewChat: () => void;
}) {
  const m = useMessages();
  const [actionsVisible, setActionsVisible] = useState(false);
  const [modelPickerVisible, setModelPickerVisible] = useState(false);

  const openModelPicker = useCallback(() => {
    setModelPickerVisible(true);
  }, []);

  const closeModelPicker = useCallback(() => {
    setModelPickerVisible(false);
  }, []);

  const startNewChat = useCallback(() => {
    setActionsVisible(false);
    onNewChat();
  }, [onNewChat]);

  const openFiles = useCallback(() => {
    setActionsVisible(false);
    onFilesPress?.();
  }, [onFilesPress]);

  const openAgentPicker = useCallback(() => {
    setActionsVisible(false);
    onAgentPress();
  }, [onAgentPress]);

  return (
    <>
      <View style={[styles.header, { paddingTop }]}>
        <View style={styles.sideSlot}>
          {onBackPress ? (
            <Pressable style={styles.iconButton} onPress={onBackPress} hitSlop={6}>
              <Icon source="chevron-left" size={26} color={pillText} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.headerCenter}>
          <Pressable
            style={styles.titlePressable}
            onPress={openModelPicker}
            accessibilityRole="button"
            accessibilityLabel={`${m.chat.headerModelPicker}: ${modelName}`}
          >
            <Text style={[styles.modelTitle, { color: pillText }]} numberOfLines={1}>
              {modelName}
            </Text>
            <Icon source="chevron-down" size={16} color={pillText} />
          </Pressable>
        </View>

        <View style={styles.rightActions}>
          <Pressable
            style={styles.iconButton}
            onPress={onAutoReadAloudToggle}
            hitSlop={6}
            accessibilityRole="switch"
            accessibilityState={{ checked: autoReadAloudEnabled }}
            accessibilityLabel={autoReadAloudEnabled
              ? m.chat.autoReadAloudDisable
              : m.chat.autoReadAloudEnable}
          >
            <Icon
              source={autoReadAloudEnabled ? 'volume-high' : 'volume-off'}
              size={23}
              color={pillText}
            />
          </Pressable>
          <Pressable
            style={styles.iconButton}
            onPress={() => setActionsVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={m.chat.headerActions}
          >
            <Icon source="dots-horizontal" size={24} color={pillText} />
          </Pressable>
        </View>
      </View>

      <ChatActionsSheet
        visible={actionsVisible}
        agentName={agentName}
        onDismiss={() => setActionsVisible(false)}
        onAgentPress={openAgentPicker}
        onFilesPress={onFilesPress ? openFiles : undefined}
        onNewChat={startNewChat}
      />
      <ModelPickerMenu
        visible={modelPickerVisible}
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
  sideSlot: {
    width: 88,
    alignItems: 'flex-start',
  },
  rightActions: {
    width: 88,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
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
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 8,
  },
  modelTitle: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});

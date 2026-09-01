import { memo, useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Menu, Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import type { ChatModelOption } from '../../query/models';

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
  const pickerTopOffset = paddingTop + 52;

  const openModelPicker = useCallback(() => {
    setActionsVisible(false);
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
            onPress={onAgentPress}
            accessibilityRole="button"
            accessibilityLabel={m.chat.headerAgentPicker}
          >
            <Text style={[styles.agentTitle, { color: pillText }]} numberOfLines={1}>
              {agentName}
            </Text>
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
          <Menu
            visible={actionsVisible}
            onDismiss={() => setActionsVisible(false)}
            anchor={(
              <Pressable
                style={styles.iconButton}
                onPress={() => setActionsVisible(true)}
                accessibilityRole="button"
                accessibilityLabel={m.chat.headerActions}
              >
                <Icon source="view-grid-outline" size={23} color={pillText} />
              </Pressable>
            )}
          >
            <Menu.Item
              leadingIcon="swap-horizontal"
              title={`${m.chat.headerModelPicker} · ${modelName}`}
              onPress={openModelPicker}
            />
            <Menu.Item
              leadingIcon="square-edit-outline"
              title={m.chat.headerNewChat}
              onPress={startNewChat}
            />
            {onFilesPress ? (
              <Menu.Item
                leadingIcon="folder-outline"
                title={m.chat.openSessionFiles}
                onPress={openFiles}
              />
            ) : null}
          </Menu>
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
    paddingHorizontal: 4,
  },
  agentTitle: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});

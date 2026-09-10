import { memo, useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import type { ChatModelOption } from '../../query/models';
import { radii, typography, useTheme } from '../../theme';

import { ChatActionsSheet } from './ChatActionsSheet';
import { ModelPickerMenu } from './ModelPickerMenu';

export const ChatHeader = memo(function ChatHeader({
  agentName,
  modelName,
  models,
  currentModelId,
  paddingTop,
  pillText,
  voiceCallActive,
  voiceCallDisabled,
  onBackPress,
  onNavigationPress,
  navigationAttentionCount = 0,
  onAgentPress,
  onVoiceCallPress,
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
  voiceCallActive: boolean;
  voiceCallDisabled: boolean;
  onBackPress?: () => void;
  onNavigationPress?: () => void;
  navigationAttentionCount?: number;
  onAgentPress: () => void;
  onVoiceCallPress: () => void;
  onModelSelect: (modelId: string) => void;
  onFilesPress?: () => void;
  onNewChat: () => void;
}) {
  const m = useMessages();
  const { colors } = useTheme();
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
        {onBackPress || onNavigationPress ? (
          <View style={styles.sideSlot}>
            <Pressable
              style={styles.iconButton}
              onPress={onBackPress ?? onNavigationPress}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={onBackPress ? m.common.back : m.drawer.chats}
            >
              <Icon source={onBackPress ? 'chevron-left' : 'menu'} size={onBackPress ? 26 : 23} color={pillText} />
              {!onBackPress && navigationAttentionCount > 0 ? (
                <View style={[styles.attentionBadge, { backgroundColor: colors.semantic.warning }]}>
                  <Text style={[styles.attentionBadgeText, { color: colors.accent.onPrimary }]}>
                    {navigationAttentionCount > 9 ? '9+' : navigationAttentionCount}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          </View>
        ) : null}

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
            style={[styles.iconButton, voiceCallDisabled && styles.disabled]}
            onPress={onVoiceCallPress}
            disabled={voiceCallDisabled}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={voiceCallActive ? m.voice.expand : m.voice.title}
            accessibilityState={{ disabled: voiceCallDisabled }}
          >
            <Icon
              source={voiceCallActive ? 'phone-in-talk' : 'phone-outline'}
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
    position: 'relative',
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attentionBadge: {
    position: 'absolute',
    top: 3,
    right: 1,
    minWidth: 17,
    height: 17,
    borderRadius: radii.full,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attentionBadgeText: {
    ...typography.micro,
  },
  disabled: { opacity: 0.44 },
  sideSlot: {
    width: 44,
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
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingLeft: 4,
    paddingRight: 8,
  },
  titlePressable: {
    maxWidth: '100%',
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
  },
  modelTitle: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'left',
  },
});

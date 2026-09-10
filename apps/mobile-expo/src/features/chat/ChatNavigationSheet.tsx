import { useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMessages } from '../../i18n/messages';
import { sessionDisplayName } from '../../lib/session-helpers';
import { motion } from '../../motion';
import type { SessionListItem } from '../../query/sessions';
import { radii, spacing, typography, useTheme } from '../../theme';

type NavigationItem = { icon: string; label: string; route: string; count?: number };

export const ChatNavigationSheet = memo(function ChatNavigationSheet({
  visible,
  onDismiss,
  currentSessionKey,
  recentSessions,
  attentionCount,
  onSessionSelect,
  onNewChat,
}: {
  visible: boolean;
  onDismiss: () => void;
  currentSessionKey: string;
  recentSessions: SessionListItem[];
  attentionCount: number;
  onSessionSelect: (sessionKey: string) => void;
  onNewChat: () => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { colors } = useTheme();
  const m = useMessages();
  const copy = m.drawer;
  const drawerWidth = Math.min(windowWidth * 0.88, 360);
  const [mounted, setMounted] = useState(visible);
  const translateX = useRef(new Animated.Value(-drawerWidth)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateX.setValue(-drawerWidth);
      requestAnimationFrame(() => {
        Animated.timing(translateX, {
          toValue: 0,
          duration: motion.duration.standard,
          useNativeDriver: true,
        }).start();
      });
      return;
    }
    if (!mounted) return;
    Animated.timing(translateX, {
      toValue: -drawerWidth,
      duration: motion.duration.quick,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [drawerWidth, mounted, translateX, visible]);

  const navigate = useCallback((route: string) => {
    onDismiss();
    router.push(route as never);
  }, [onDismiss, router]);

  const chooseSession = useCallback((sessionKey: string) => {
    onDismiss();
    onSessionSelect(sessionKey);
  }, [onDismiss, onSessionSelect]);

  const startNewChat = useCallback(() => {
    onDismiss();
    onNewChat();
  }, [onDismiss, onNewChat]);

  const workbench: NavigationItem[] = [
    { icon: 'alert-circle-outline', label: copy.needsAttention, route: '/attention', count: attentionCount },
    { icon: 'checkbox-marked-circle-outline', label: copy.tasks, route: '/tasks' },
    { icon: 'folder-multiple-outline', label: copy.projects, route: '/projects' },
    { icon: 'inbox-arrow-down-outline', label: copy.inbox, route: '/inbox' },
    { icon: 'note-text-outline', label: copy.notes, route: '/notes' },
    { icon: 'folder-outline', label: copy.files, route: '/files' },
    { icon: 'clock-outline', label: copy.automation, route: '/automation' },
    { icon: 'account-multiple-outline', label: copy.agents, route: '/ai/agents' },
    { icon: 'cog-outline', label: copy.settings, route: '/settings' },
  ];

  if (!mounted) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <Animated.View
          testID="chat-navigation-drawer"
          style={[
            styles.drawer,
            {
              width: drawerWidth,
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
              backgroundColor: colors.surface.panel,
              borderRightColor: colors.border.subtle,
              transform: [{ translateX }],
            },
          ]}
          accessibilityViewIsModal
        >
          <View style={styles.header}>
            <Text style={[styles.headerTitle, { color: colors.text.primary }]}>{copy.chats}</Text>
            <Pressable
              style={styles.close}
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel={m.common.close}
            >
              <Icon source="close" size={21} color={colors.text.secondary} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
        <Pressable
          style={[styles.newChat, { backgroundColor: colors.accent.primary }]}
          onPress={startNewChat}
          accessibilityRole="button"
        >
          <Icon source="square-edit-outline" size={20} color={colors.accent.onPrimary} />
          <Text style={[styles.newChatText, { color: colors.accent.onPrimary }]}>{copy.newChat}</Text>
        </Pressable>

        {recentSessions.length ? (
          <>
            <Text style={[styles.sectionLabel, { color: colors.text.tertiary }]}>{copy.recentChats}</Text>
            <View style={[styles.group, { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle }]}>
              {recentSessions.slice(0, 5).map((session) => {
                const current = session.key === currentSessionKey;
                return (
                  <Pressable
                    key={session.key}
                    style={({ pressed }) => [
                      styles.row,
                      current && { backgroundColor: colors.surface.active },
                      pressed && { backgroundColor: colors.surface.pressed },
                    ]}
                    onPress={() => chooseSession(session.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: current }}
                  >
                    <Icon source="message-outline" size={19} color={current ? colors.accent.primary : colors.text.secondary} />
                    <Text style={[styles.rowLabel, { color: colors.text.primary }]} numberOfLines={1}>
                      {sessionDisplayName(session, m.sessions.untitled)}
                    </Text>
                    {current ? <Text style={[styles.current, { color: colors.accent.primary }]}>{copy.currentChat}</Text> : null}
                  </Pressable>
                );
              })}
              <Pressable style={styles.row} onPress={() => navigate('/sessions')} accessibilityRole="button">
                <Icon source="history" size={19} color={colors.text.secondary} />
                <Text style={[styles.rowLabel, { color: colors.text.primary }]}>{copy.historyTitle}</Text>
                <Icon source="chevron-right" size={18} color={colors.text.tertiary} />
              </Pressable>
            </View>
          </>
        ) : null}

        <Text style={[styles.sectionLabel, { color: colors.text.tertiary }]}>{copy.workbench}</Text>
        <View style={[styles.group, { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle }]}>
          {workbench.map((item) => (
            <Pressable
              key={item.route}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface.pressed }]}
              onPress={() => navigate(item.route)}
              accessibilityRole="button"
            >
              <Icon
                source={item.icon}
                size={19}
                color={item.count ? colors.semantic.warning : colors.text.secondary}
              />
              <Text style={[styles.rowLabel, { color: colors.text.primary }]}>{item.label}</Text>
              {item.count ? (
                <View style={[styles.badge, { backgroundColor: colors.semantic.warning }]}>
                  <Text style={[styles.badgeText, { color: colors.accent.onPrimary }]}>{item.count}</Text>
                </View>
              ) : <Icon source="chevron-right" size={18} color={colors.text.tertiary} />}
            </Pressable>
          ))}
        </View>
          </ScrollView>
        </Animated.View>
        <Pressable style={[styles.scrim, { backgroundColor: colors.overlay.scrim }]} onPress={onDismiss} accessible={false} />
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  overlay: { flex: 1, flexDirection: 'row' },
  drawer: { height: '100%', borderRightWidth: StyleSheet.hairlineWidth },
  scrim: { flex: 1 },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.content, paddingRight: spacing.sm },
  headerTitle: { ...typography.heading, flex: 1 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  newChat: { minHeight: 48, marginHorizontal: spacing.sm, borderRadius: radii.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  newChatText: { ...typography.ui, fontWeight: '600' },
  sectionLabel: { ...typography.label, fontWeight: '600', marginTop: spacing.xl, marginBottom: spacing.sm, marginHorizontal: spacing.md },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, overflow: 'hidden' },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md },
  rowLabel: { ...typography.ui, flex: 1, minWidth: 0 },
  current: { ...typography.caption },
  badge: { minWidth: 24, height: 24, borderRadius: radii.full, paddingHorizontal: spacing.xs, alignItems: 'center', justifyContent: 'center' },
  badgeText: { ...typography.micro },
});

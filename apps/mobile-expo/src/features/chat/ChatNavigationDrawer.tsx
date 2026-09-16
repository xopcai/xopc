import { useFocusEffect, useRouter } from 'expo-router';
import { memo, useCallback, useImperativeHandle, useRef, type ReactNode, type Ref } from 'react';
import {
  BackHandler,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import ReanimatedDrawerLayout, {
  DrawerKeyboardDismissMode, DrawerLockMode, DrawerPosition, DrawerState, DrawerType,
  type DrawerLayoutMethods,
} from 'react-native-gesture-handler/ReanimatedDrawerLayout';
import { Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMessages } from '../../i18n/messages';
import { sessionDisplayName } from '../../lib/session-helpers';
import type { SessionListItem } from '../../query/sessions';
import { radii, spacing, typography, useTheme } from '../../theme';


export type ChatNavigationDrawerHandle = { open: () => void };

export const ChatNavigationDrawer = memo(function ChatNavigationDrawer({
  ref,
  children,
  swipeEnabled,
  onInteraction,
  currentConversationId,
  recentSessions,
  onSessionSelect,
  onNewChat,
}: {
  ref?: Ref<ChatNavigationDrawerHandle>;
  children: ReactNode;
  swipeEnabled: boolean;
  onInteraction: () => void;
  currentConversationId: string;
  recentSessions: SessionListItem[];
  onSessionSelect: (conversationId: string) => void;
  onNewChat: () => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { colors } = useTheme();
  const m = useMessages();
  const copy = m.drawer;
  const drawerWidth = Math.min(windowWidth * 0.88, 360);
  const drawerRef = useRef<DrawerLayoutMethods>(null);
  const drawerActive = useRef(false);
  const onDismiss = useCallback(() => drawerRef.current?.closeDrawer(), []);
  const prepareToOpen = useCallback(() => {
    Keyboard.dismiss();
    onInteraction();
  }, [onInteraction]);

  useImperativeHandle(ref, () => ({
    open: () => {
      prepareToOpen();
      drawerRef.current?.openDrawer();
    },
  }), [prepareToOpen]);

  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!drawerActive.current) return false;
      onDismiss();
      return true;
    });
    return () => {
      subscription.remove();
      onDismiss();
    };
  }, [onDismiss]));

  const navigate = useCallback((route: string) => {
    onDismiss();
    router.push(route as never);
  }, [onDismiss, router]);

  const chooseSession = useCallback((conversationId: string) => {
    onDismiss();
    onSessionSelect(conversationId);
  }, [onDismiss, onSessionSelect]);

  const startNewChat = useCallback(() => {
    onDismiss();
    onNewChat();
  }, [onDismiss, onNewChat]);


  return (
    <ReanimatedDrawerLayout
      ref={drawerRef}
      drawerPosition={DrawerPosition.LEFT}
      drawerType={DrawerType.FRONT}
      drawerWidth={drawerWidth}
      drawerBackgroundColor={colors.surface.panel}
      overlayColor={colors.overlay.scrim}
      edgeWidth={spacing.xxl}
      minSwipeDistance={spacing.md}
      drawerLockMode={swipeEnabled ? DrawerLockMode.UNLOCKED : DrawerLockMode.LOCKED_CLOSED}
      keyboardDismissMode={DrawerKeyboardDismissMode.ON_DRAG}
      onDrawerStateChanged={(state, willShow) => {
        if (state === DrawerState.DRAGGING) prepareToOpen();
        if (willShow) drawerActive.current = true;
      }}
      onDrawerOpen={() => { drawerActive.current = true; }}
      onDrawerClose={() => { drawerActive.current = false; }}
      renderNavigationView={() => (
        <View
          testID="chat-navigation-drawer"
          style={[
            styles.drawer,
            {
              width: drawerWidth,
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
              backgroundColor: colors.surface.panel,
              borderRightColor: colors.border.subtle,
            },
          ]}
          onAccessibilityEscape={onDismiss}
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
                const current = session.key === currentConversationId;
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

          </ScrollView>
        </View>
      )}
    >
      {children}
    </ReanimatedDrawerLayout>
  );
});

const styles = StyleSheet.create({
  drawer: { height: '100%', borderRightWidth: StyleSheet.hairlineWidth },
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
});

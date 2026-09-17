import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAttentionFeed } from '@/features/attention/use-attention-feed';
import { CapsuleTabBar, CapsuleTabButton, CapsuleTabIcon, TAB_DOCK_HEIGHT, TAB_DOCK_INSET } from '@/features/navigation/CapsuleTabBar';
import { useMessages } from '@/i18n/messages';
import { radii, spacing, typography, useTheme } from '@/theme';

export default function PrimaryTabs() {
  const { colors } = useTheme();
  const m = useMessages().mobileExperience;
  const insets = useSafeAreaInsets();
  const attention = useAttentionFeed();
  const count = attention.data?.needsUser.length ?? 0;
  return (
    <Tabs tabBar={props => <CapsuleTabBar {...props} />} screenOptions={{
      headerShown: false,
      tabBarActiveBackgroundColor: 'transparent',
      tabBarInactiveBackgroundColor: 'transparent',
      tabBarButton: props => <CapsuleTabButton {...props} />,
      tabBarLabelPosition: 'below-icon',
      tabBarActiveTintColor: colors.accent.primary,
      tabBarInactiveTintColor: colors.text.secondary,
      tabBarLabelStyle: { ...typography.micro, fontWeight: '600' },
      tabBarItemStyle: { borderRadius: radii.full, paddingVertical: 0 },
      tabBarStyle: {
        backgroundColor: 'transparent',
        borderTopWidth: 0,
        borderRadius: radii.full,
        marginHorizontal: spacing.md,
        marginBottom: Math.max(insets.bottom, spacing.sm),
        height: TAB_DOCK_HEIGHT,
        paddingTop: TAB_DOCK_INSET,
        paddingBottom: TAB_DOCK_INSET,
        paddingHorizontal: TAB_DOCK_INSET,
        elevation: 0,
      },
    }}>
      <Tabs.Screen name="(chat)" options={{ title: m.chat, tabBarIcon: ({ focused }) => <CapsuleTabIcon source="message-outline" focused={focused} /> }} />
      <Tabs.Screen name="progress" options={{ title: m.progress, tabBarBadge: count || undefined, tabBarBadgeStyle: { backgroundColor: colors.accent.soft, color: colors.accent.primary }, tabBarIcon: ({ focused }) => <CapsuleTabIcon source="checkbox-marked-circle-outline" focused={focused} /> }} />
      <Tabs.Screen name="library" options={{ title: m.library, tabBarIcon: ({ focused }) => <CapsuleTabIcon source="layers-outline" focused={focused} /> }} />
      <Tabs.Screen name="settings" options={{ title: m.personal, tabBarIcon: ({ focused }) => <CapsuleTabIcon source="account-outline" focused={focused} /> }} />
    </Tabs>
  );
}

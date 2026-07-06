import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { FloatingHeader } from '../../components/FloatingHeader';
import { useMessages } from '../../i18n/messages';
import { dismissOrHome, useDismissOnHardwareBack } from '../../lib/navigation';
import { useGatewayConfigured } from '../../query/sessions';
import { radii, spacing, typography, useTheme } from '../../theme';

import { CronRunsList } from './CronRunsList';
import { SchedulesList } from './SchedulesList';

type AutomationTab = 'schedules' | 'runs';

export function AutomationScreen() {
  const router = useRouter();
  useDismissOnHardwareBack(router);
  const { colors } = useTheme();
  const configured = useGatewayConfigured();
  const m = useMessages();
  const pm = m.automationPage;
  const [tab, setTab] = useState<AutomationTab>('schedules');

  const screenBg = colors.surface.base;
  const tabBg = colors.surface.input;
  const activeTabBg = colors.surface.panel;
  const tabText = colors.text.secondary;
  const activeTabText = colors.text.primary;

  const selectTab = useCallback((next: AutomationTab) => {
    setTab(next);
  }, []);

  return (
    <View style={[styles.screen, { backgroundColor: screenBg }]}>
      <FloatingHeader
        title={pm.title}
        onBack={() => dismissOrHome(router)}
        rightIcon={tab === 'schedules' ? 'plus' : undefined}
        onRightPress={tab === 'schedules' ? () => router.push('/automation/form') : undefined}
      />

      {!configured ? (
        <View style={styles.center}>
          <Text style={{ color: colors.text.tertiary }}>{m.sessions.gatewayNotConfigured}</Text>
        </View>
      ) : (
        <>
          <View style={[styles.tabBar, { backgroundColor: tabBg }]}>
            <TabButton
              label={pm.schedulesTab}
              active={tab === 'schedules'}
              onPress={() => selectTab('schedules')}
              activeBg={activeTabBg}
              textColor={tabText}
              activeTextColor={activeTabText}
            />
            <TabButton
              label={pm.runsTab}
              active={tab === 'runs'}
              onPress={() => selectTab('runs')}
              activeBg={activeTabBg}
              textColor={tabText}
              activeTextColor={activeTabText}
            />
          </View>
          <View style={styles.content}>
            {tab === 'schedules' ? (
              <View style={styles.page}>
                <SchedulesList />
              </View>
            ) : (
              <View style={styles.page}>
                <CronRunsList />
              </View>
            )}
          </View>
        </>
      )}
    </View>
  );
}

function TabButton({
  label,
  active,
  onPress,
  activeBg,
  textColor,
  activeTextColor,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  activeBg: string;
  textColor: string;
  activeTextColor: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.tabButton,
        active && { backgroundColor: activeBg },
      ]}
    >
      <Text
        style={[
          styles.tabLabel,
          { color: active ? activeTextColor : textColor },
          active && styles.tabLabelActive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: radii.lg,
    padding: spacing.xs,
    gap: spacing.xs,
  },
  tabButton: {
    flex: 1,
    borderRadius: radii.md,
    paddingVertical: spacing.sm + spacing.xxs,
    alignItems: 'center',
  },
  tabLabel: {
    ...typography.ui,
    fontWeight: '500',
  },
  tabLabelActive: {
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  page: {
    flex: 1,
  },
});

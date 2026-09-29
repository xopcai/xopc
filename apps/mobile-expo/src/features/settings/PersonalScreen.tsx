import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { useMessages } from '../../i18n/messages';
import { queryKeys } from '../../query/keys';
import { useGatewayConfigured } from '../../query/sessions';
import { fetchUserProfileSummary, type MobileUserGoal } from '../../query/user-profile';
import { useGatewayStore } from '../../stores/gateway-store';
import { radii, spacing, typography, useTheme } from '../../theme';

import { GoalEditorModal } from './GoalEditorModal';

function profileInitials(name: string): string {
  return Array.from(name.trim()).slice(0, 2).join('').toUpperCase();
}

function SectionHeading({ title, action, onPress }: { title: string; action?: string; onPress?: () => void }) {
  const { colors } = useTheme();
  return <View style={styles.sectionHeading}>
    <Text style={[styles.sectionTitle, { color: colors.text.secondary }]}>{title}</Text>
    {action && onPress ? <Pressable accessibilityRole="button" onPress={onPress}>
      <Text style={[styles.sectionAction, { color: colors.accent.primary }]}>{action}</Text>
    </Pressable> : null}
  </View>;
}

function UnderstandingRow({ statement, status, onPress }: { statement: string; status: string; onPress: () => void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [
    styles.understandingRow, pressed && { backgroundColor: colors.surface.pressed },
  ]}>
      <View style={styles.understandingCopy}>
        <Text style={[styles.understandingStatement, { color: colors.text.primary }]} numberOfLines={3}>{statement}</Text>
        <Text style={[styles.understandingStatus, { color: colors.text.secondary }]}>{status}</Text>
      </View>
      <Icon source="chevron-right" size={19} color={colors.text.tertiary} />
    </Pressable>;
}

function GoalRow({ goal, onPress }: { goal: MobileUserGoal; onPress: () => void }) {
  const { colors } = useTheme();
  const copy = useMessages().mobileExperience.goals;
  const status = goal.isPrimary ? copy.primary : copy[goal.status];
  const target = goal.targetAt ? copy.due.replace('{{date}}', new Date(goal.targetAt).toLocaleDateString()) : '';
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [
    styles.goalRow,
    { backgroundColor: pressed ? colors.surface.pressed : colors.surface.panel, borderColor: colors.border.subtle },
  ]}>
    <View style={[styles.goalMarker, { backgroundColor: goal.isPrimary ? colors.accent.primary : colors.accent.soft }]} />
    <View style={styles.understandingCopy}>
      <Text style={[styles.goalTitle, { color: colors.text.primary }]} numberOfLines={2}>{goal.title}</Text>
      <Text style={[styles.goalOutcome, { color: colors.text.secondary }]} numberOfLines={2}>{goal.desiredOutcome}</Text>
      <Text style={[styles.goalMeta, { color: goal.isPrimary ? colors.accent.primary : colors.text.tertiary }]}>{status}{target ? ` · ${target}` : ''}</Text>
    </View>
    <Icon source="pencil-outline" size={19} color={colors.text.tertiary} />
  </Pressable>;
}

export function PersonalScreen() {
  const router = useRouter();
  const { colors, elevation } = useTheme();
  const messages = useMessages();
  const m = messages.mobileExperience;
  const understanding = m.understanding;
  const goalsCopy = m.goals;
  const [editingGoal, setEditingGoal] = useState<MobileUserGoal | undefined>();
  const [goalEditorOpen, setGoalEditorOpen] = useState(false);
  const configured = useGatewayConfigured();
  const activeGatewayId = useGatewayStore(state => state.activeGatewayId);
  const profile = useQuery({
    queryKey: queryKeys.userProfile(activeGatewayId ?? ''),
    queryFn: fetchUserProfileSummary,
    enabled: configured && Boolean(activeGatewayId),
    staleTime: 5 * 60_000,
  });
  const profileName = profile.data?.profile.callName || profile.data?.suggestedCallName || messages.drawer.you;
  const profileRole = profile.data?.profile.role || messages.drawer.profileHint;
  const openUnderstanding = () => router.push('/settings/understanding');
  const openUnderstandingItem = (id: string) => router.push(`/settings/understanding/${encodeURIComponent(id)}`);
  const openGoalEditor = (goal?: MobileUserGoal) => { setEditingGoal(goal); setGoalEditorOpen(true); };

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader
        title={m.personal}
        largeTitle
        rightActions={[{
          icon: 'cog-outline',
          accessibilityLabel: messages.settings.title,
          onPress: () => router.push('/settings/preferences'),
        }]}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable accessibilityRole="button" onPress={openUnderstanding} style={({ pressed }) => [
          styles.profileCard,
          elevation.raised,
          { backgroundColor: pressed ? colors.surface.pressed : colors.surface.panel, borderColor: colors.border.subtle },
        ]}>
          <View style={[styles.avatar, { backgroundColor: colors.accent.soft }]}>
            <Text style={[styles.avatarText, { color: colors.accent.primary }]}>{profileInitials(profileName)}</Text>
          </View>
          <View style={styles.profileCopy}>
            <Text style={[styles.profileName, { color: colors.text.primary }]} numberOfLines={1}>{profileName}</Text>
            <Text style={[styles.profileRole, { color: colors.text.secondary }]} numberOfLines={2}>{profileRole}</Text>
            <View style={[styles.connectionBadge, { backgroundColor: configured ? colors.accent.soft : colors.surface.grouped }]}>
              <View style={[styles.statusDot, { backgroundColor: configured ? colors.semantic.success : colors.text.tertiary }]} />
              <Text style={[styles.connectionText, { color: configured ? colors.accent.primary : colors.text.secondary }]} numberOfLines={1}>
                {configured ? m.workspaceConnected : m.workspaceDisconnected}
              </Text>
            </View>
            {profile.data ? <Text style={[styles.understandingCount, { color: colors.text.secondary }]}>
              {m.understanding.summaryCount.replace('{{count}}', String(profile.data.counts.total))}
              {profile.data.counts.review ? ` · ${m.understanding.reviewCount.replace('{{count}}', String(profile.data.counts.review))}` : ''}
            </Text> : null}
          </View>
          <Icon source="chevron-right" size={20} color={colors.text.tertiary} />
        </Pressable>

        {profile.data ? <View style={styles.section}>
          <SectionHeading title={goalsCopy.title} action={goalsCopy.add} onPress={() => openGoalEditor()} />
          {profile.data.goals.length ? profile.data.goals.map(goal => <GoalRow
            key={goal.id} goal={goal} onPress={() => openGoalEditor(goal)}
          />) : <Pressable accessibilityRole="button" onPress={() => openGoalEditor()} style={[
            styles.emptyGoal, { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle },
          ]}>
            <Icon source="flag-plus-outline" size={24} color={colors.accent.primary} />
            <View style={styles.understandingCopy}>
              <Text style={[styles.goalTitle, { color: colors.text.primary }]}>{goalsCopy.empty}</Text>
              <Text style={[styles.goalOutcome, { color: colors.text.secondary }]}>{goalsCopy.emptyHint}</Text>
            </View>
          </Pressable>}
        </View> : null}

        {profile.data ? <View style={styles.section}>
          <SectionHeading title={understanding.counts} action={understanding.all} onPress={openUnderstanding} />
          <Pressable accessibilityRole="button" onPress={openUnderstanding} style={({ pressed }) => [
            styles.insightCard,
            { backgroundColor: pressed ? colors.surface.pressed : colors.surface.panel, borderColor: colors.border.subtle },
          ]}>
            <Text style={[styles.insightHelp, { color: colors.text.secondary }]}>{understanding.subtitle}</Text>
            <View style={styles.countRow}>
              <View style={styles.countCell}><Text style={[styles.countValue, { color: colors.text.primary }]}>{profile.data.counts.explicit}</Text><Text style={[styles.countLabel, { color: colors.text.secondary }]}>{understanding.explicit}</Text></View>
              <View style={styles.countCell}><Text style={[styles.countValue, { color: colors.text.primary }]}>{profile.data.counts.learned}</Text><Text style={[styles.countLabel, { color: colors.text.secondary }]}>{understanding.learned}</Text></View>
              <View style={styles.countCell}><Text style={[styles.countValue, { color: profile.data.counts.review ? colors.accent.primary : colors.text.primary }]}>{profile.data.counts.review}</Text><Text style={[styles.countLabel, { color: colors.text.secondary }]}>{understanding.needsReview}</Text></View>
            </View>
            <View style={styles.memoryRow}><Icon source="bookshelf" size={19} color={colors.text.secondary} /><Text style={[styles.memoryText, { color: colors.text.secondary }]}>{profile.data.counts.workMemory} {understanding.workMemory}</Text></View>
          </Pressable>
        </View> : null}

        {profile.data?.recent.length ? <View style={styles.section}>
          <SectionHeading title={understanding.recent} />
          <View style={[styles.listCard, { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle }]}>
            {profile.data.recent.slice(0, 3).map(item => <UnderstandingRow key={item.id} statement={item.statement} status={item.authority === 'user_explicit' ? understanding.explicit : understanding.learned} onPress={() => openUnderstandingItem(item.id)} />)}
          </View>
        </View> : null}

        {profile.data?.rules.length ? <View style={styles.section}>
          <SectionHeading title={understanding.rules} />
          <View style={[styles.listCard, { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle }]}>
            {profile.data.rules.slice(0, 3).map(item => <UnderstandingRow key={item.id} statement={item.statement} status={understanding.rules} onPress={() => openUnderstandingItem(item.id)} />)}
          </View>
        </View> : null}

        <View style={styles.section}>
          <SectionHeading title={m.memoryPrivacy.title} />
          <Pressable accessibilityRole="button" onPress={() => router.push('/settings/memory')} style={({ pressed }) => [
            styles.privacyCard,
            { backgroundColor: pressed ? colors.surface.pressed : colors.surface.panel, borderColor: colors.border.subtle },
          ]}>
            <View style={[styles.privacyIcon, { backgroundColor: colors.accent.soft }]}>
              <Icon source="shield-account-outline" size={22} color={colors.accent.primary} />
            </View>
            <View style={styles.understandingCopy}>
              <Text style={[styles.goalTitle, { color: colors.text.primary }]}>{m.memoryPrivacy.entryTitle}</Text>
              <Text style={[styles.goalOutcome, { color: colors.text.secondary }]}>{m.memoryPrivacy.entryHint}</Text>
            </View>
            <Icon source="chevron-right" size={19} color={colors.text.tertiary} />
          </Pressable>
        </View>
      </ScrollView>
      <GoalEditorModal goal={editingGoal} visible={goalEditorOpen} onDismiss={() => setGoalEditorOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.content, paddingTop: spacing.sm, paddingBottom: spacing.xxxl, gap: spacing.section },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, padding: spacing.xl, borderRadius: radii.xl, borderWidth: StyleSheet.hairlineWidth },
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...typography.title, fontWeight: '700' },
  profileCopy: { flex: 1, minWidth: 0 },
  profileName: { ...typography.title },
  profileRole: { ...typography.label, marginTop: spacing.xs },
  connectionBadge: { minHeight: 28, maxWidth: '100%', marginTop: spacing.md, paddingHorizontal: spacing.sm, borderRadius: radii.full, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: spacing.sm },
  connectionText: { ...typography.caption, fontWeight: '600', flexShrink: 1 },
  understandingCount: { ...typography.caption, marginTop: spacing.sm },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  section: { gap: spacing.sm },
  sectionHeading: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xs },
  sectionTitle: { ...typography.label, fontWeight: '600' },
  sectionAction: { ...typography.label, fontWeight: '600' },
  insightCard: { padding: spacing.lg, borderRadius: radii.xl, borderWidth: StyleSheet.hairlineWidth, gap: spacing.md },
  goalRow: { minHeight: 108, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl, borderWidth: StyleSheet.hairlineWidth },
  goalMarker: { width: 5, alignSelf: 'stretch', borderRadius: radii.full },
  goalTitle: { ...typography.heading },
  goalOutcome: { ...typography.body, marginTop: spacing.xs },
  goalMeta: { ...typography.caption, marginTop: spacing.sm, fontWeight: '600' },
  emptyGoal: { minHeight: 108, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl, borderWidth: StyleSheet.hairlineWidth },
  insightHelp: { ...typography.body },
  countRow: { flexDirection: 'row', gap: spacing.sm },
  countCell: { flex: 1, alignItems: 'center' },
  countValue: { ...typography.title, fontWeight: '700' },
  countLabel: { ...typography.caption, marginTop: spacing.xs, textAlign: 'center' },
  memoryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  memoryText: { ...typography.label },
  listCard: { borderRadius: radii.xl, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  privacyCard: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl, borderWidth: StyleSheet.hairlineWidth },
  privacyIcon: { width: 44, height: 44, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center' },
  understandingRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  understandingCopy: { flex: 1, minWidth: 0 },
  understandingStatement: { ...typography.body },
  understandingStatus: { ...typography.caption, marginTop: spacing.xs },
});

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { useMessages } from '../../i18n/messages';
import { queryKeys } from '../../query/keys';
import { useGatewayConfigured } from '../../query/sessions';
import { fetchUserProfileSummary } from '../../query/user-profile';
import { useGatewayStore } from '../../stores/gateway-store';
import { usePreferencesStore } from '../../stores/preferences-store';
import { radii, spacing, typography, useTheme } from '../../theme';

function profileInitials(name: string): string {
  return Array.from(name.trim()).slice(0, 2).join('').toUpperCase();
}

function ActionCard({
  icon,
  title,
  description,
  onPress,
}: {
  icon: string;
  title: string;
  description: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionCard,
        {
          backgroundColor: pressed ? colors.surface.pressed : colors.surface.panel,
          borderColor: colors.border.subtle,
        },
      ]}
    >
      <View style={[styles.actionIcon, { backgroundColor: colors.accent.soft }]}>
        <Icon source={icon} size={22} color={colors.accent.primary} />
      </View>
      <Text style={[styles.actionTitle, { color: colors.text.primary }]}>{title}</Text>
      <Text style={[styles.actionDescription, { color: colors.text.secondary }]} numberOfLines={2}>
        {description}
      </Text>
    </Pressable>
  );
}

function StatusRow({
  icon,
  label,
  value,
  active,
  onPress,
  isLast,
}: {
  icon: string;
  label: string;
  value: string;
  active: boolean;
  onPress: () => void;
  isLast?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.statusRow,
        !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle },
        pressed && { backgroundColor: colors.surface.pressed },
      ]}
    >
      <Icon source={icon} size={21} color={colors.text.secondary} />
      <Text style={[styles.statusLabel, { color: colors.text.primary }]}>{label}</Text>
      <View style={[styles.statusDot, { backgroundColor: active ? colors.semantic.success : colors.text.tertiary }]} />
      <Text style={[styles.statusValue, { color: colors.text.secondary }]} numberOfLines={1}>{value}</Text>
      <Icon source="chevron-right" size={19} color={colors.text.tertiary} />
    </Pressable>
  );
}

export function PersonalScreen() {
  const router = useRouter();
  const { colors, elevation } = useTheme();
  const messages = useMessages();
  const m = messages.mobileExperience;
  const configured = useGatewayConfigured();
  const activeGatewayId = useGatewayStore(state => state.activeGatewayId);
  const activeProfile = useGatewayStore(state =>
    state.activeGatewayId
      ? state.profiles.find(profile => profile.gatewayId === state.activeGatewayId) ?? null
      : null,
  );
  const notificationsEnabled = usePreferencesStore(state => state.notificationsEnabled);
  const profile = useQuery({
    queryKey: queryKeys.userProfile(activeGatewayId ?? ''),
    queryFn: fetchUserProfileSummary,
    enabled: configured && Boolean(activeGatewayId),
    staleTime: 5 * 60_000,
  });
  const profileName = profile.data?.callName || profile.data?.suggestedCallName || messages.drawer.you;
  const profileRole = profile.data?.role || messages.drawer.profileHint;
  const connectionValue = configured && activeProfile ? activeProfile.name : m.workspaceDisconnected;

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
        <View style={[
          styles.profileCard,
          elevation.raised,
          { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle },
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
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text.secondary }]}>{m.personalServices}</Text>
          <View style={styles.actionGrid}>
            <ActionCard
              icon="robot-outline"
              title={messages.agentsPage.title}
              description={m.agentsHint}
              onPress={() => router.push('/ai/agents')}
            />
            <ActionCard
              icon="account-multiple-outline"
              title={messages.sharingPage.title}
              description={m.sharingHint}
              onPress={() => router.push('/sharing')}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text.secondary }]}>{m.deviceStatus}</Text>
          <View style={[styles.statusCard, { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle }]}>
            <StatusRow
              icon="web"
              label={messages.settings.gateway}
              value={connectionValue}
              active={configured}
              onPress={() => router.push('/settings/gateway')}
            />
            <StatusRow
              icon="bell-outline"
              label={messages.settings.notifications}
              value={notificationsEnabled ? m.statusOn : m.statusOff}
              active={notificationsEnabled}
              onPress={() => router.push('/settings/preferences')}
              isLast
            />
          </View>
        </View>
      </ScrollView>
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
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.label, fontWeight: '600', marginLeft: spacing.xs },
  actionGrid: { flexDirection: 'row', gap: spacing.md },
  actionCard: { flex: 1, minHeight: 142, padding: spacing.lg, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth },
  actionIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  actionTitle: { ...typography.heading },
  actionDescription: { ...typography.caption, marginTop: spacing.xs },
  statusCard: { borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  statusRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  statusLabel: { ...typography.ui, flex: 1 },
  statusValue: { ...typography.label, maxWidth: 112 },
});

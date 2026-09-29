import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Icon, Switch, Text } from 'react-native-paper';

import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { useMessages } from '../../i18n/messages';
import { userFacingErrorMessage } from '../../lib/user-facing-error';
import { queryKeys } from '../../query/keys';
import {
  fetchUserProfileSummary,
  updateMemorySettings,
  type MobileUserUnderstandingSummary,
} from '../../query/user-profile';
import { useGatewayConfigured } from '../../query/sessions';
import { useGatewayStore } from '../../stores/gateway-store';
import { radii, spacing, typography, useTheme } from '../../theme';

import { shareUserMemoryExport } from './memory-export';

type SensitivePolicy = MobileUserUnderstandingSummary['settings']['sensitiveWritePolicy'];

export function MemoryPrivacyScreen() {
  const router = useRouter();
  const client = useQueryClient();
  const { colors } = useTheme();
  const messages = useMessages();
  const copy = messages.mobileExperience.memoryPrivacy;
  const configured = useGatewayConfigured();
  const gatewayId = useGatewayStore(state => state.activeGatewayId) ?? '';
  const summary = useQuery({
    queryKey: queryKeys.userProfile(gatewayId),
    queryFn: fetchUserProfileSummary,
    enabled: configured && Boolean(gatewayId),
  });
  const settingsMutation = useMutation({
    mutationFn: updateMemorySettings,
    onSuccess: async () => { await client.invalidateQueries({ queryKey: queryKeys.userProfile(gatewayId) }); },
    onError: error => Alert.alert(copy.title, userFacingErrorMessage(error, messages.mobileExperience.errors, 'save')),
  });
  const exportMutation = useMutation({
    mutationFn: shareUserMemoryExport,
    onError: error => Alert.alert(copy.title, userFacingErrorMessage(error, messages.mobileExperience.errors, 'save')),
  });
  const settings = summary.data?.settings;
  const disabled = !settings || settingsMutation.isPending;

  return <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
    <NativeScreenHeader title={copy.title} onBack={() => router.back()} />
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.intro}>
        <View style={[styles.heroIcon, { backgroundColor: colors.accent.soft }]}>
          <Icon source="shield-account-outline" size={24} color={colors.accent.primary} />
        </View>
        <View style={styles.flex}>
          <Text style={[styles.heading, { color: colors.text.primary }]}>{copy.heading}</Text>
          <Text style={[styles.body, { color: colors.text.secondary }]}>{copy.subtitle}</Text>
        </View>
      </View>

      <Section title={copy.memoryUse}>
        <SettingRow
          icon="brain"
          title={copy.longTermMemory}
          detail={copy.longTermMemoryHint}
          value={settings?.memoryEnabled ?? false}
          disabled={disabled}
          onChange={value => settingsMutation.mutate({ memoryEnabled: value })}
        />
        <SettingRow
          icon="creation-outline"
          title={copy.references}
          detail={copy.referencesHint}
          value={settings?.showMemoryReferences ?? false}
          disabled={disabled}
          onChange={value => settingsMutation.mutate({ showMemoryReferences: value })}
        />
        <View style={styles.policyRow}>
          <Text style={[styles.rowTitle, { color: colors.text.primary }]}>{copy.sensitive}</Text>
          <Text style={[styles.rowDetail, { color: colors.text.secondary }]}>{copy.sensitiveHint}</Text>
          <View style={[styles.segment, { backgroundColor: colors.surface.grouped }]}>
            {(['confirm', 'deny', 'allow'] as const).map(policy => <Pressable
              key={policy}
              accessibilityRole="button"
              accessibilityState={{ selected: settings?.sensitiveWritePolicy === policy, disabled }}
              disabled={disabled}
              onPress={() => settingsMutation.mutate({ sensitiveWritePolicy: policy satisfies SensitivePolicy })}
              style={[styles.segmentItem, settings?.sensitiveWritePolicy === policy && { backgroundColor: colors.surface.panel }]}
            >
              <Text style={[styles.segmentText, { color: settings?.sensitiveWritePolicy === policy ? colors.text.primary : colors.text.secondary }]}>{copy[policy]}</Text>
            </Pressable>)}
          </View>
        </View>
      </Section>

      <Section title={copy.dataManagement}>
        <ActionRow icon="download-outline" title={copy.export} detail={copy.exportHint} onPress={() => exportMutation.mutate()} />
        <ActionRow icon="pencil-outline" title={copy.manage} detail={copy.manageHint} onPress={() => router.push('/settings/understanding')} />
      </Section>
      <Button mode="text" onPress={() => router.push('/settings/privacy')}>{copy.dataSharing}</Button>
    </ScrollView>
  </View>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return <View style={styles.section}>
    <Text style={[styles.sectionTitle, { color: colors.text.secondary }]}>{title}</Text>
    <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle }]}>{children}</View>
  </View>;
}

function SettingRow({ icon, title, detail, value, disabled, onChange }: {
  icon: string; title: string; detail: string; value: boolean; disabled: boolean; onChange: (value: boolean) => void;
}) {
  const { colors } = useTheme();
  return <View style={styles.row}>
    <Icon source={icon} size={20} color={colors.text.secondary} />
    <View style={styles.flex}><Text style={[styles.rowTitle, { color: colors.text.primary }]}>{title}</Text><Text style={[styles.rowDetail, { color: colors.text.secondary }]}>{detail}</Text></View>
    <Switch value={value} disabled={disabled} onValueChange={onChange} />
  </View>;
}

function ActionRow({ icon, title, detail, onPress }: { icon: string; title: string; detail: string; onPress: () => void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface.pressed }]}>
    <Icon source={icon} size={20} color={colors.text.secondary} />
    <View style={styles.flex}><Text style={[styles.rowTitle, { color: colors.text.primary }]}>{title}</Text><Text style={[styles.rowDetail, { color: colors.text.secondary }]}>{detail}</Text></View>
    <Icon source="chevron-right" size={20} color={colors.text.tertiary} />
  </Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing.content, paddingBottom: spacing.xxxl, gap: spacing.section },
  intro: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  heroIcon: { width: 48, height: 48, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center' },
  heading: { ...typography.heading }, body: { ...typography.body, marginTop: spacing.xs }, flex: { flex: 1, minWidth: 0 },
  section: { gap: spacing.sm }, sectionTitle: { ...typography.label, fontWeight: '600', paddingHorizontal: spacing.xs },
  card: { borderRadius: radii.xl, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  rowTitle: { ...typography.label, fontWeight: '600' }, rowDetail: { ...typography.caption, marginTop: spacing.xs },
  policyRow: { minHeight: 116, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  segment: { flexDirection: 'row', marginTop: spacing.md, padding: 3, borderRadius: radii.full },
  segmentItem: { flex: 1, minHeight: 44, borderRadius: radii.full, alignItems: 'center', justifyContent: 'center' },
  segmentText: { ...typography.label, fontWeight: '600' },
});

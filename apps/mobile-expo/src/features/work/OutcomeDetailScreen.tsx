import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';

import { ListSkeleton } from '../../components/ListSkeleton';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { useMessages } from '../../i18n/messages';
import { actOnOutcome, fetchOutcome } from '../../query/outcomes';
import { queryKeys } from '../../query/keys';
import { radii, spacing, typography, useTheme } from '../../theme';

export function OutcomeDetailScreen() {
  const router = useRouter();
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const hm = useMessages().homePage;
  const query = useQuery({
    queryKey: queryKeys.outcome(id),
    queryFn: () => fetchOutcome(id),
    enabled: Boolean(id),
  });
  const action = useMutation({
    mutationFn: (value: 'run' | 'pause' | 'resume' | 'cancel') => actOnOutcome(id, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.outcome(id) }),
  });

  const statusLabel = query.data
    ? {
        running: hm.outcomeStatusRunning,
        needs_user: hm.outcomeStatusNeedsYou,
        completed: hm.outcomeStatusCompleted,
      }[query.data.outcome.userStatus]
    : '';
  const verificationLabels = {
    passed: hm.verificationPassed,
    failed: hm.verificationFailed,
    unverified: hm.verificationPending,
  } as const;

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader title={query.data?.outcome.objective ?? ''} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content}>
        {query.isLoading ? <ListSkeleton count={3} /> : query.isError || !query.data ? (
          <Text style={[styles.empty, { color: colors.semantic.error }]}>{hm.outcomeLoadFailed}</Text>
        ) : (
          <>
            <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
              <Text style={[styles.eyebrow, { color: colors.accent.primary }]}>{statusLabel}</Text>
              <Text style={[styles.title, { color: colors.text.primary }]}>{query.data.outcome.objective}</Text>
              {query.data.outcome.internalStatus !== 'completed' && query.data.outcome.internalStatus !== 'cancelled' ? (
                <View style={styles.actions}>
                  <Button
                    mode={query.data.outcome.internalStatus === 'paused' || query.data.outcome.internalStatus === 'captured' ? 'contained' : 'outlined'}
                    disabled={action.isPending}
                    onPress={() => action.mutate(
                      query.data.outcome.internalStatus === 'paused'
                        ? 'resume'
                        : query.data.outcome.internalStatus === 'captured' ? 'run' : 'pause',
                    )}
                  >
                    {query.data.outcome.internalStatus === 'paused'
                      ? hm.outcomeResume
                      : query.data.outcome.internalStatus === 'captured' ? hm.outcomeRun : hm.outcomePause}
                  </Button>
                  <Button mode="text" disabled={action.isPending} onPress={() => action.mutate('cancel')}>
                    {hm.outcomeCancel}
                  </Button>
                </View>
              ) : null}
              {action.isError ? <Text style={[styles.meta, { color: colors.semantic.error }]}>{hm.outcomeActionFailed}</Text> : null}
            </View>

            <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
              <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{hm.outcomeDefinition}</Text>
              {(query.data.outcome.contract?.acceptanceCriteria.length ?? 0) === 0 ? (
                <Text style={[styles.body, { color: colors.text.secondary }]}>{hm.outcomeDefinitionPending}</Text>
              ) : query.data.outcome.contract?.acceptanceCriteria.map((criterion) => (
                <View key={criterion} style={styles.row}>
                  <Icon source="check-circle-outline" size={18} color={colors.semantic.success} />
                  <Text style={[styles.body, styles.rowText, { color: colors.text.primary }]}>{criterion}</Text>
                </View>
              ))}
              {(query.data.outcome.contract?.deliverables.length ?? 0) > 0 ? (
                <>
                  <Text style={[styles.subheading, { color: colors.text.secondary }]}>{hm.outcomeDeliverables}</Text>
                  {query.data.outcome.contract?.deliverables.map((deliverable) => (
                    <Text key={deliverable} style={[styles.body, { color: colors.text.primary }]}>• {deliverable}</Text>
                  ))}
                </>
              ) : null}
            </View>

            <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
              <Text style={[styles.sectionTitle, { color: colors.text.primary }]}>{hm.outcomeReceipts}</Text>
              {query.data.receipts.length === 0 ? (
                <Text style={[styles.body, { color: colors.text.secondary }]}>{hm.outcomeReceiptsEmpty}</Text>
              ) : query.data.receipts.map((receipt) => (
                <View key={receipt.runId} style={[styles.receipt, { borderColor: colors.border.subtle }]}>
                  <Text style={[styles.body, { color: colors.text.primary }]}>{receipt.summary}</Text>
                  <Text style={[styles.meta, { color: colors.text.tertiary }]}>{verificationLabels[receipt.verification.status]}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  eyebrow: { ...typography.micro },
  title: { ...typography.title },
  sectionTitle: { ...typography.heading, marginBottom: spacing.xs },
  subheading: { ...typography.label, marginTop: spacing.sm },
  body: { ...typography.body },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  rowText: { flex: 1 },
  receipt: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.md, marginTop: spacing.xs, gap: spacing.xs },
  meta: { ...typography.caption },
  empty: { ...typography.body, padding: spacing.lg, textAlign: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
});

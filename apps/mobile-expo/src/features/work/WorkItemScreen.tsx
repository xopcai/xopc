import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { useMessages } from '../../i18n/messages';
import { dismissOrHome } from '../../lib/navigation';
import { queryKeys } from '../../query/keys';
import { executeWorkItemCommand, fetchWorkItem, patchWorkItemMetadata, type WorkItemCommand } from '../../query/work-items';
import { useGatewayConfigured } from '../../query/sessions';
import { radii, spacing, typography, useTheme } from '../../theme';

function firstParam(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] ?? '' : value ?? ''; }

export function WorkItemScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const workItemId = firstParam(id);
  const insets = useSafeAreaInsets();
  const configured = useGatewayConfigured();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const { workPage: labels } = useMessages();
  const query = useQuery({ queryKey: queryKeys.workItem(workItemId), queryFn: () => fetchWorkItem(workItemId), enabled: configured && !!workItemId });
  const [nextAction, setNextAction] = useState('');
  useEffect(() => setNextAction(query.data?.item.nextAction?.text ?? ''), [query.data?.item.nextAction?.text]);
  const update = useMutation({
    mutationFn: (action: { kind: 'metadata'; nextAction: string } | { kind: 'command'; command: WorkItemCommand }) => (
      action.kind === 'metadata'
        ? patchWorkItemMetadata(workItemId, query.data!.item.version, {
            nextAction: action.nextAction.trim() ? { text: action.nextAction.trim(), actor: query.data!.item.nextAction?.actor ?? 'agent' } : null,
          }).then((item) => ({ item, availableCommands: query.data!.availableCommands }))
        : executeWorkItemCommand(workItemId, action.command)
    ),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.workItem(workItemId), result);
      void queryClient.invalidateQueries({ queryKey: queryKeys.workItems() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectWorkItems(result.item.projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
  const item = query.data?.item;
  const primaryType = (['commit', 'start', 'request_review', 'complete', 'accept', 'reopen'] as const)
    .find((type) => query.data?.availableCommands.includes(type));
  const primaryCommand: WorkItemCommand | undefined = item && primaryType
    ? primaryType === 'request_review'
      ? { type: primaryType, expectedVersion: item.version, summary: 'Ready for verification.' }
      : { type: primaryType, expectedVersion: item.version }
    : undefined;
  const primaryLabel = primaryType === 'start' || primaryType === 'commit' || primaryType === 'reopen' ? labels.start : labels.complete;

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader title={labels.detailTitle} onBack={() => dismissOrHome(router)} />
      {query.isLoading || !item ? <View style={styles.loading}><ActivityIndicator /></View> : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
          <Text style={[styles.title, { color: colors.text.primary }]}>{item.title}</Text>
          <Text style={[styles.status, { color: colors.accent.primary }]}>{labels.status[item.phase]}</Text>
          {item.description ? <Text style={[styles.description, { color: colors.text.secondary }]}>{item.description}</Text> : null}
          <View style={[styles.section, { borderColor: colors.border.default, backgroundColor: colors.surface.panel }]}>
            <Text style={[styles.label, { color: colors.text.primary }]}>{labels.nextAction}</Text>
            <TextInput value={nextAction} onChangeText={setNextAction} placeholder={labels.nextActionPlaceholder} placeholderTextColor={colors.text.tertiary} style={[styles.input, { color: colors.text.primary, borderColor: colors.border.default }]} multiline />
            <Pressable disabled={update.isPending} onPress={() => update.mutate({ kind: 'metadata', nextAction })} style={({ pressed }) => [styles.button, { backgroundColor: colors.accent.primary, opacity: pressed || update.isPending ? 0.7 : 1 }]}><Text style={styles.buttonText}>{labels.save}</Text></Pressable>
          </View>
          {item.waits.filter((wait) => !wait.resolvedAt).map((wait) => <View key={wait.id} style={[styles.section, { borderColor: colors.border.default, backgroundColor: colors.surface.panel }]}><Text style={[styles.label, { color: colors.text.primary }]}>{wait.kind}</Text><Text style={{ color: colors.text.secondary }}>{wait.reason}</Text></View>)}
          {primaryCommand ? <Pressable disabled={update.isPending} onPress={() => update.mutate({ kind: 'command', command: primaryCommand })} style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.accent.primary, opacity: pressed || update.isPending ? 0.7 : 1 }]}><Text style={styles.buttonText}>{primaryLabel}</Text></Pressable> : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center' }, content: { padding: spacing.md, gap: spacing.md },
  title: { ...typography.title, fontWeight: '700' }, status: { ...typography.caption, fontWeight: '700' }, description: { ...typography.body },
  section: { gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md }, label: { ...typography.body, fontWeight: '600' },
  input: { ...typography.body, minHeight: 72, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.sm, textAlignVertical: 'top' },
  button: { alignSelf: 'flex-start', borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }, primaryButton: { alignItems: 'center', borderRadius: radii.md, padding: spacing.md }, buttonText: { color: '#fff', fontWeight: '700' },
});

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
import { fetchWorkItem, patchWorkItem, type WorkItemStatus } from '../../query/work-items';
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
  useEffect(() => setNextAction(query.data?.nextAction ?? ''), [query.data?.nextAction]);
  const update = useMutation({
    mutationFn: (patch: { status?: WorkItemStatus; nextAction?: string | null }) => patchWorkItem(workItemId, patch),
    onSuccess: (item) => {
      queryClient.setQueryData(queryKeys.workItem(workItemId), item);
      void queryClient.invalidateQueries({ queryKey: queryKeys.workItems() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectWorkItems(item.projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.home });
    },
  });
  const item = query.data;
  const primaryStatus: WorkItemStatus | undefined = item?.status === 'todo' || item?.status === 'backlog'
    ? 'in_progress'
    : item?.status === 'in_progress' || item?.status === 'in_review' ? 'done' : undefined;
  const primaryLabel = primaryStatus === 'in_progress' ? labels.start : labels.complete;

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader title={labels.detailTitle} onBack={() => dismissOrHome(router)} />
      {query.isLoading || !item ? <View style={styles.loading}><ActivityIndicator /></View> : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
          <Text style={[styles.title, { color: colors.text.primary }]}>{item.title}</Text>
          <Text style={[styles.status, { color: colors.accent.primary }]}>{labels.status[item.status]}</Text>
          {item.description ? <Text style={[styles.description, { color: colors.text.secondary }]}>{item.description}</Text> : null}
          <View style={[styles.section, { borderColor: colors.border.default, backgroundColor: colors.surface.panel }]}>
            <Text style={[styles.label, { color: colors.text.primary }]}>{labels.nextAction}</Text>
            <TextInput value={nextAction} onChangeText={setNextAction} placeholder={labels.nextActionPlaceholder} placeholderTextColor={colors.text.tertiary} style={[styles.input, { color: colors.text.primary, borderColor: colors.border.default }]} multiline />
            <Pressable disabled={update.isPending} onPress={() => update.mutate({ nextAction: nextAction.trim() || null })} style={({ pressed }) => [styles.button, { backgroundColor: colors.accent.primary, opacity: pressed || update.isPending ? 0.7 : 1 }]}><Text style={styles.buttonText}>{labels.save}</Text></Pressable>
          </View>
          {item.blockedReason ? <View style={[styles.section, { borderColor: colors.border.default, backgroundColor: colors.surface.panel }]}><Text style={[styles.label, { color: colors.text.primary }]}>{labels.blocked}</Text><Text style={{ color: colors.text.secondary }}>{item.blockedReason}</Text></View> : null}
          {primaryStatus ? <Pressable disabled={update.isPending} onPress={() => update.mutate({ status: primaryStatus })} style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.accent.primary, opacity: pressed || update.isPending ? 0.7 : 1 }]}><Text style={styles.buttonText}>{primaryLabel}</Text></Pressable> : null}
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

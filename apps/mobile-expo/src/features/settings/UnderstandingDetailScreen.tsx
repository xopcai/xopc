import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Icon, Text, TextInput } from 'react-native-paper';

import { BrandLoadingState } from '../../components/BrandLoadingState';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { useMessages } from '../../i18n/messages';
import { queryKeys } from '../../query/keys';
import { deleteUnderstanding, fetchUnderstandingItem, updateUnderstanding } from '../../query/user-profile';
import { useGatewayStore } from '../../stores/gateway-store';
import { radii, spacing, typography, useTheme } from '../../theme';

export function UnderstandingDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const client = useQueryClient();
  const gatewayId = useGatewayStore(s => s.activeGatewayId) ?? '';
  const { colors } = useTheme();
  const messages = useMessages();
  const copy = messages.mobileExperience.understanding;
  const item = useQuery({ queryKey: queryKeys.userUnderstandingItem(gatewayId, id ?? ''), queryFn: () => fetchUnderstandingItem(id!), enabled: Boolean(id) });
  const [statement, setStatement] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (item.data) setStatement(item.data.statement); }, [item.data]);
  const invalidate = async () => {
    await client.invalidateQueries({ queryKey: ['user-understanding', gatewayId] });
    await client.invalidateQueries({ queryKey: queryKeys.userProfile(gatewayId) });
  };
  const save = useMutation({ mutationFn: () => updateUnderstanding(id!, statement.trim()), onSuccess: async () => { await invalidate(); setEditing(false); } });
  const remove = useMutation({ mutationFn: () => deleteUnderstanding(id!), onSuccess: async () => { await invalidate(); router.back(); } });
  const confirmDelete = () => Alert.alert(copy.deleteTitle, copy.deleteHint, [
    { text: copy.cancel, style: 'cancel' }, { text: copy.deleteConfirm, style: 'destructive', onPress: () => remove.mutate() },
  ]);

  return <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
    <NativeScreenHeader title={copy.details} onBack={() => router.back()} />
    <ScrollView contentContainerStyle={styles.content}>
      {item.isLoading ? <BrandLoadingState label={messages.common.loading} /> : !item.data ? <Text style={{ color: colors.text.secondary }}>{copy.empty}</Text> : <>
        <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle }]}>
          {editing ? <TextInput mode="outlined" multiline label={copy.statement} value={statement} onChangeText={setStatement} />
            : <Text style={[styles.statement, { color: colors.text.primary }]}>{item.data.statement}</Text>}
          <Detail icon="account-voice" label={copy.source} value={item.data.sources.map(source => source.label || copy.unknownSource).join(' · ') || copy.unknownSource} />
          <Detail icon="earth" label={copy.scope} value={item.data.scope.type} />
          <Detail icon="calendar-outline" label={copy.recorded} value={new Date(item.data.recordedAt).toLocaleDateString()} />
          <Detail icon="chart-line" label={copy.confidence} value={`${Math.round(item.data.confidence * 100)}%`} />
        </View>
        <View style={styles.actions}>{editing ? <>
          <Button onPress={() => { setStatement(item.data!.statement); setEditing(false); }}>{copy.cancel}</Button>
          <Button mode="contained" disabled={!statement.trim()} loading={save.isPending} onPress={() => save.mutate()}>{copy.save}</Button>
        </> : <>
          <Button mode="outlined" icon="pencil-outline" onPress={() => setEditing(true)}>{copy.edit}</Button>
          <Button textColor={colors.semantic.error} icon="delete-outline" loading={remove.isPending} onPress={confirmDelete}>{copy.delete}</Button>
        </>}</View>
      </>}
    </ScrollView>
  </View>;
}

function Detail({ icon, label, value }: { icon: string; label: string; value: string }) {
  const { colors } = useTheme();
  return <View style={styles.detail}><Icon source={icon} size={19} color={colors.text.tertiary} /><View style={styles.flex}><Text style={[styles.label, { color: colors.text.secondary }]}>{label}</Text><Text style={[styles.value, { color: colors.text.primary }]}>{value}</Text></View></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { padding: spacing.content, paddingBottom: spacing.xxxl, gap: spacing.lg },
  card: { padding: spacing.xl, borderRadius: radii.xl, borderWidth: StyleSheet.hairlineWidth, gap: spacing.lg }, statement: { ...typography.heading, lineHeight: 26 },
  detail: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }, flex: { flex: 1 }, label: { ...typography.caption }, value: { ...typography.body, marginTop: spacing.xs },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
});

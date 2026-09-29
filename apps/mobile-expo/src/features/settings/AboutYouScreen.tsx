import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Icon, Modal, Portal, Text, TextInput } from 'react-native-paper';

import { ListSkeleton } from '../../components/ListSkeleton';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { useMessages } from '../../i18n/messages';
import { queryKeys } from '../../query/keys';
import {
  fetchUnderstandingPage,
  fetchUserProfileSummary,
  updateUserProfile,
  type MobileUnderstandingFilter,
  type MobileUserUnderstandingSummary,
} from '../../query/user-profile';
import { useGatewayConfigured } from '../../query/sessions';
import { useGatewayStore } from '../../stores/gateway-store';
import { radii, spacing, typography, useTheme } from '../../theme';

type Section = 'overview' | 'understanding';

export function AboutYouScreen() {
  const router = useRouter();
  const client = useQueryClient();
  const { colors } = useTheme();
  const copy = useMessages().mobileExperience.understanding;
  const configured = useGatewayConfigured();
  const gatewayId = useGatewayStore(s => s.activeGatewayId) ?? '';
  const [section, setSection] = useState<Section>('overview');
  const [filter, setFilter] = useState<MobileUnderstandingFilter>('all');
  const [editing, setEditing] = useState(false);
  const summary = useQuery({
    queryKey: queryKeys.userProfile(gatewayId), queryFn: fetchUserProfileSummary,
    enabled: configured && Boolean(gatewayId), staleTime: 60_000,
  });
  const list = useInfiniteQuery({
    queryKey: queryKeys.userUnderstanding(gatewayId, filter),
    queryFn: ({ pageParam }) => fetchUnderstandingPage(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: page => page.nextCursor,
    enabled: configured && Boolean(gatewayId) && section === 'understanding',
  });
  const items = useMemo(() => list.data?.pages.flatMap(page => page.items) ?? [], [list.data]);
  const refresh = async () => {
    await Promise.all([summary.refetch(), section === 'understanding' ? list.refetch() : Promise.resolve()]);
  };

  return <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
    <NativeScreenHeader title={copy.title} onBack={() => router.back()} />
    <View style={[styles.segment, { backgroundColor: colors.surface.grouped }]}>
      {(['overview', 'understanding'] as const).map(value => <Pressable key={value} onPress={() => setSection(value)} style={[
        styles.segmentItem, section === value && { backgroundColor: colors.surface.panel },
      ]}>
        <Text style={[styles.segmentText, { color: section === value ? colors.text.primary : colors.text.secondary }]}>
          {value === 'overview' ? copy.overview : copy.understanding}
        </Text>
      </Pressable>)}
    </View>
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={summary.isFetching || list.isFetching} onRefresh={() => void refresh()} />}
    >
      <Text style={[styles.subtitle, { color: colors.text.secondary }]}>{copy.subtitle}</Text>
      {!configured ? <Empty text={useMessages().mobileExperience.connectHint} />
        : summary.isLoading ? <ListSkeleton count={5} />
          : summary.isError || !summary.data ? <Empty text={useMessages().mobileExperience.loadFailed} />
            : section === 'overview'
              ? <Overview data={summary.data} onEdit={() => setEditing(true)} onOpenUnderstanding={() => setSection('understanding')} />
              : <UnderstandingList
                  filter={filter} onFilter={setFilter} items={items}
                  loading={list.isLoading} hasMore={list.hasNextPage}
                  onMore={() => void list.fetchNextPage()}
                  onOpen={id => router.push(`/settings/understanding/${encodeURIComponent(id)}`)}
                />}
    </ScrollView>
    {summary.data ? <ProfileEditor
      visible={editing} initial={summary.data.profile} onDismiss={() => setEditing(false)}
      onSaved={async () => { setEditing(false); await client.invalidateQueries({ queryKey: queryKeys.userProfile(gatewayId) }); }}
    /> : null}
  </View>;
}

function Overview({ data, onEdit, onOpenUnderstanding }: {
  data: MobileUserUnderstandingSummary; onEdit: () => void; onOpenUnderstanding: () => void;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const copy = useMessages().mobileExperience.understanding;
  const name = data.profile.callName || data.suggestedCallName || useMessages().drawer.you;
  return <View style={styles.sections}>
    <Card>
      <View style={styles.cardHeader}><View style={styles.flex}><Text style={[styles.cardTitle, { color: colors.text.primary }]}>{copy.basics}</Text>
        <Text style={[styles.primaryText, { color: colors.text.primary }]}>{name}</Text>
        {data.profile.role ? <Text style={[styles.secondaryText, { color: colors.text.secondary }]}>{data.profile.role}</Text> : null}</View>
        <Button compact onPress={onEdit}>{copy.editProfile}</Button></View>
    </Card>
    <Card title={copy.currentFocus}><Text style={[styles.primaryText, { color: colors.text.primary }]}>{data.primaryFocus?.title ?? copy.noFocus}</Text>
      {data.primaryFocus?.desiredOutcome ? <Text style={[styles.secondaryText, { color: colors.text.secondary }]}>{data.primaryFocus.desiredOutcome}</Text> : null}</Card>
    <Card title={copy.counts} onPress={onOpenUnderstanding}>
      <View style={styles.countRow}>
        <Count value={data.counts.explicit} label={copy.explicit} />
        <Count value={data.counts.learned} label={copy.learned} />
        <Count value={data.counts.review} label={copy.needsReview} accent={data.counts.review > 0} />
      </View>
    </Card>
    {data.recent.length ? <Card title={copy.recent}>{data.recent.map(item => <Row key={item.id} text={item.statement} />)}</Card> : null}
    {data.rules.length ? <Card title={copy.rules}>{data.rules.map(item => <Row key={item.id} text={item.statement} icon="handshake-outline" />)}</Card> : null}
    <Card title={copy.workMemory} onPress={() => router.push('/library')}>
      <View style={styles.cardHeader}><View style={styles.flex}><Text style={[styles.primaryText, { color: colors.text.primary }]}>{data.counts.workMemory}</Text>
        <Text style={[styles.secondaryText, { color: colors.text.secondary }]}>{copy.workMemoryHint}</Text></View><Icon source="chevron-right" size={20} color={colors.text.tertiary} /></View>
    </Card>
  </View>;
}

function UnderstandingList({ filter, onFilter, items, loading, hasMore, onMore, onOpen }: {
  filter: MobileUnderstandingFilter; onFilter: (value: MobileUnderstandingFilter) => void;
  items: Array<{ id: string; statement: string; authority: string; status: string }>;
  loading: boolean; hasMore: boolean; onMore: () => void; onOpen: (id: string) => void;
}) {
  const { colors } = useTheme();
  const copy = useMessages().mobileExperience.understanding;
  const filters: MobileUnderstandingFilter[] = ['all', 'explicit', 'learned', 'review'];
  return <View style={styles.sections}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
      {filters.map(value => <Pressable key={value} onPress={() => onFilter(value)} style={[
        styles.filter, { backgroundColor: filter === value ? colors.accent.soft : colors.surface.panel, borderColor: filter === value ? colors.accent.primary : colors.border.subtle },
      ]}><Text style={{ color: filter === value ? colors.accent.primary : colors.text.secondary }}>{value === 'all' ? copy.all : value === 'explicit' ? copy.explicit : value === 'learned' ? copy.learned : copy.review}</Text></Pressable>)}
    </ScrollView>
    {loading ? <ListSkeleton count={6} /> : items.length ? <Card>{items.map(item => <Pressable key={item.id} onPress={() => onOpen(item.id)} style={styles.listRow}>
      <View style={styles.flex}><Text style={[styles.primaryText, { color: colors.text.primary }]} numberOfLines={3}>{item.statement}</Text>
        <Text style={[styles.secondaryText, { color: colors.text.secondary }]}>{item.status === 'needs_review' || item.status === 'conflicted' ? copy.needsReview : item.authority === 'user_explicit' ? copy.explicit : copy.learned}</Text></View>
      <Icon source="chevron-right" size={20} color={colors.text.tertiary} />
    </Pressable>)}</Card> : <Empty text={copy.empty} />}
    {hasMore ? <Button onPress={onMore}>{copy.loadMore}</Button> : null}
  </View>;
}

function ProfileEditor({ visible, initial, onDismiss, onSaved }: {
  visible: boolean; initial: MobileUserUnderstandingSummary['profile']; onDismiss: () => void; onSaved: () => Promise<void>;
}) {
  const { colors } = useTheme();
  const copy = useMessages().mobileExperience.understanding;
  const [value, setValue] = useState(initial);
  const mutation = useMutation({ mutationFn: () => updateUserProfile(value), onSuccess: onSaved });
  const fields = ['callName', 'role', 'pronouns', 'timezone', 'locale'] as const;
  return <Portal><Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={[styles.modal, { backgroundColor: colors.surface.panel }]}>
    <Text style={[styles.cardTitle, { color: colors.text.primary }]}>{copy.editProfile}</Text>
    {fields.map(field => <TextInput key={field} mode="outlined" label={copy[field]} value={value[field]} onChangeText={text => setValue(current => ({ ...current, [field]: text }))} />)}
    <View style={styles.modalActions}><Button onPress={onDismiss}>{copy.cancel}</Button><Button mode="contained" loading={mutation.isPending} onPress={() => mutation.mutate()}>{copy.save}</Button></View>
  </Modal></Portal>;
}

function Card({ title, onPress, children }: { title?: string; onPress?: () => void; children: React.ReactNode }) {
  const { colors } = useTheme();
  const content = <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle }]}>{title ? <Text style={[styles.cardTitle, { color: colors.text.primary }]}>{title}</Text> : null}{children}</View>;
  return onPress ? <Pressable onPress={onPress}>{content}</Pressable> : content;
}
function Row({ text, icon = 'brain' }: { text: string; icon?: string }) { const { colors } = useTheme(); return <View style={styles.row}><Icon source={icon} size={19} color={colors.accent.primary} /><Text style={[styles.primaryText, styles.flex, { color: colors.text.primary }]}>{text}</Text></View>; }
function Count({ value, label, accent }: { value: number; label: string; accent?: boolean }) { const { colors } = useTheme(); return <View style={styles.count}><Text style={[styles.countValue, { color: accent ? colors.accent.primary : colors.text.primary }]}>{value}</Text><Text style={[styles.countLabel, { color: colors.text.secondary }]}>{label}</Text></View>; }
function Empty({ text }: { text: string }) { const { colors } = useTheme(); return <View style={[styles.empty, { backgroundColor: colors.surface.panel }]}><Text style={[styles.secondaryText, { color: colors.text.secondary }]}>{text}</Text></View>; }

const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { padding: spacing.content, paddingBottom: spacing.xxxl, gap: spacing.lg }, subtitle: { ...typography.body },
  segment: { flexDirection: 'row', marginHorizontal: spacing.content, marginTop: spacing.sm, padding: 3, borderRadius: radii.full }, segmentItem: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radii.full }, segmentText: { ...typography.label, fontWeight: '600' },
  sections: { gap: spacing.md }, card: { padding: spacing.lg, borderRadius: radii.xl, borderWidth: StyleSheet.hairlineWidth, gap: spacing.md }, cardTitle: { ...typography.heading }, cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  primaryText: { ...typography.body }, secondaryText: { ...typography.label, marginTop: spacing.xs }, flex: { flex: 1, minWidth: 0 },
  countRow: { flexDirection: 'row', gap: spacing.sm }, count: { flex: 1 }, countValue: { ...typography.title, fontWeight: '700' }, countLabel: { ...typography.caption, marginTop: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }, listRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  filters: { gap: spacing.sm }, filter: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radii.full, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  empty: { padding: spacing.xl, borderRadius: radii.xl, alignItems: 'center' }, modal: { margin: spacing.xl, padding: spacing.xl, borderRadius: radii.xl, gap: spacing.md }, modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
});

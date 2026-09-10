import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppToast } from '../../components/AppToast';
import { ListSkeleton } from '../../components/ListSkeleton';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { useMessages } from '../../i18n/messages';
import { dismissOrRoot, useDismissOnHardwareBack } from '../../lib/navigation';
import { floatingBottomPadding, radii, spacing, typography, useTheme } from '../../theme';

import { AttentionItemRow } from './AttentionItemRow';
import { useAttentionActions } from './use-attention-actions';
import { useAttentionFeed } from './use-attention-feed';

export function AttentionScreen() {
  const router = useRouter();
  useDismissOnHardwareBack(router);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const copy = useMessages().attentionCenter;
  const query = useAttentionFeed();
  const actions = useAttentionActions();
  const items = query.data?.needsUser ?? [];

  return (
    <View style={[styles.screen, { backgroundColor: colors.surface.base }]}>
      <NativeScreenHeader title={copy.title} largeTitle onBack={() => dismissOrRoot(router)} />
      {query.isLoading ? (
        <View style={styles.loading}><ListSkeleton count={4} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: floatingBottomPadding(insets.bottom) + spacing.xl },
          ]}
          refreshControl={(
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={() => void query.refetch()}
              tintColor={colors.text.tertiary}
            />
          )}
        >
          {query.isError ? (
            <View style={styles.state}>
              <Icon source="cloud-alert-outline" size={28} color={colors.semantic.error} />
              <Text style={[styles.stateTitle, { color: colors.text.primary }]}>{copy.loadFailed}</Text>
            </View>
          ) : items.length ? (
            <View style={[styles.group, { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle }]}>
              {items.map((item) => (
                <AttentionItemRow
                  key={item.id}
                  item={item}
                  pending={actions.pending}
                  onAction={actions.runAction}
                />
              ))}
            </View>
          ) : (
            <View style={styles.state}>
              <Icon source="check-circle-outline" size={30} color={colors.semantic.success} />
              <Text style={[styles.stateTitle, { color: colors.text.primary }]}>{copy.emptyTitle}</Text>
              <Text style={[styles.stateHint, { color: colors.text.secondary }]}>{copy.emptyHint}</Text>
            </View>
          )}
        </ScrollView>
      )}
      <AppToast visible={Boolean(actions.feedback)} onDismiss={actions.clearFeedback}>
        {actions.feedback}
      </AppToast>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loading: { padding: spacing.content },
  content: { flexGrow: 1, paddingHorizontal: spacing.content, paddingTop: spacing.md },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, overflow: 'hidden' },
  state: { flex: 1, minHeight: 320, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  stateTitle: { ...typography.heading, textAlign: 'center', marginTop: spacing.md },
  stateHint: { ...typography.body, textAlign: 'center', marginTop: spacing.sm },
});

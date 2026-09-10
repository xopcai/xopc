import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { AppToast } from '../../components/AppToast';
import { BottomSheetModal } from '../../components/BottomSheetModal';
import { useMessages, t } from '../../i18n/messages';
import type { HomeAction, HomeFocusItem } from '../../query/home';
import { radii, spacing, typography, useTheme } from '../../theme';

import { AttentionItemRow } from './AttentionItemRow';
import { markAttentionSeen, readAttentionSeen, unseenAttentionItems } from './attention-seen';
import { useAttentionActions } from './use-attention-actions';

export function ChatAttentionTray({
  gatewayId,
  items,
}: {
  gatewayId: string | null;
  items: HomeFocusItem[];
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const m = useMessages();
  const copy = m.attentionCenter;
  const [sheetVisible, setSheetVisible] = useState(false);
  const [seen, setSeen] = useState(() => readAttentionSeen(gatewayId));
  const actions = useAttentionActions();

  useEffect(() => {
    setSeen(readAttentionSeen(gatewayId));
    setSheetVisible(false);
  }, [gatewayId]);

  const unseen = useMemo(() => unseenAttentionItems(items, seen), [items, seen]);
  const orderedItems = useMemo(() => {
    const newIds = new Set(unseen.map((item) => item.id));
    return [...unseen, ...items.filter((item) => !newIds.has(item.id))];
  }, [items, unseen]);
  const first = unseen[0];

  const dismissTray = useCallback(() => {
    setSeen(markAttentionSeen(gatewayId, items));
  }, [gatewayId, items]);

  const runAction = useCallback((action: HomeAction) => {
    if (action.type === 'open' || action.type === 'review_judgment') setSheetVisible(false);
    actions.runAction(action);
  }, [actions]);

  const openAll = useCallback(() => {
    setSheetVisible(false);
    router.push('/attention');
  }, [router]);

  return (
    <>
      {first ? (
        <View
          style={[
            styles.tray,
            {
              backgroundColor: colors.accent.soft,
              borderColor: colors.semantic.warning,
            },
          ]}
        >
          <Icon source="alert-circle-outline" size={20} color={colors.semantic.warning} />
          <Pressable
            style={styles.trayMain}
            onPress={() => setSheetVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={`${first.title}. ${t(copy.trayTitle, { count: items.length })}`}
          >
            <Text style={[styles.trayTitle, { color: colors.text.primary }]} numberOfLines={1}>{first.title}</Text>
            <Text style={[styles.traySummary, { color: colors.text.secondary }]} numberOfLines={1}>{first.summary}</Text>
          </Pressable>
          <Text style={[styles.count, { color: colors.semantic.warning }]} numberOfLines={1}>
            {t(copy.trayCount, { count: items.length })}
          </Text>
          <Pressable
            style={styles.dismiss}
            onPress={dismissTray}
            accessibilityRole="button"
            accessibilityLabel={copy.trayDismiss}
            hitSlop={4}
          >
            <Icon source="close" size={18} color={colors.text.tertiary} />
          </Pressable>
        </View>
      ) : null}

      <BottomSheetModal
        visible={sheetVisible}
        onDismiss={() => setSheetVisible(false)}
        title={copy.sheetTitle}
        subtitle={copy.sheetSubtitle}
        maxHeight="78%"
        scroll
        testID="chat-attention-sheet"
      >
        <View style={[styles.sheetGroup, { backgroundColor: colors.surface.panel }]}>
          {orderedItems.slice(0, 3).map((item) => (
            <AttentionItemRow
              key={item.id}
              item={item}
              pending={actions.pending}
              onAction={runAction}
            />
          ))}
        </View>
        <Pressable style={styles.viewAll} onPress={openAll} accessibilityRole="button">
          <Text style={[styles.viewAllText, { color: colors.accent.primary }]}>{copy.viewAll}</Text>
        </Pressable>
      </BottomSheetModal>

      <AppToast visible={Boolean(actions.feedback)} onDismiss={actions.clearFeedback}>
        {actions.feedback}
      </AppToast>
    </>
  );
}

const styles = StyleSheet.create({
  tray: {
    minHeight: 52,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  trayMain: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center' },
  trayTitle: { ...typography.label, fontWeight: '600' },
  traySummary: { ...typography.caption, marginTop: spacing.xxs },
  count: { ...typography.caption, maxWidth: 92 },
  dismiss: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sheetGroup: { paddingHorizontal: spacing.sm },
  viewAll: { minHeight: 52, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  viewAllText: { ...typography.label, fontWeight: '600' },
});

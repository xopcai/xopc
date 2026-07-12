import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { useMessages, t } from '../../i18n/messages';
import {
  getPendingWorkspaceOperationCount,
  getWorkspaceSyncDeadLetters,
  retryWorkspaceSyncDeadLetter,
} from '../../sync/workspace-sync';
import { flushWorkspaceSyncNow } from '../../sync/use-workspace-sync-flush';
import { radii, spacing, typography, useTheme } from '../../theme';

type WorkspaceSyncStatusCardProps = {
  onChanged: () => void | Promise<void>;
  onToast: (message: string) => void;
};

export function WorkspaceSyncStatusCard({ onChanged, onToast }: WorkspaceSyncStatusCardProps) {
  const { colors } = useTheme();
  const m = useMessages();
  const labels = m.inboxPage.syncStatus;
  const [pendingCount, setPendingCount] = useState(() => getPendingWorkspaceOperationCount());
  const [failedCount, setFailedCount] = useState(() => getWorkspaceSyncDeadLetters().length);
  const [busy, setBusy] = useState(false);

  const refreshCounts = useCallback(() => {
    setPendingCount(getPendingWorkspaceOperationCount());
    setFailedCount(getWorkspaceSyncDeadLetters().length);
  }, []);

  useEffect(() => {
    refreshCounts();
    const interval = setInterval(refreshCounts, 5_000);
    return () => clearInterval(interval);
  }, [refreshCounts]);

  const syncNow = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const flushed = await flushWorkspaceSyncNow();
      refreshCounts();
      await onChanged();
      onToast(flushed > 0 ? t(labels.synced, { count: flushed }) : labels.nothingToSync);
    } catch (error) {
      refreshCounts();
      onToast(error instanceof Error ? error.message : labels.syncFailed);
    } finally {
      setBusy(false);
    }
  }, [busy, labels, onChanged, onToast, refreshCounts]);

  const retryFailed = useCallback(async () => {
    if (busy) return;
    const failed = getWorkspaceSyncDeadLetters();
    if (failed.length === 0) return;
    failed.forEach((operation) => retryWorkspaceSyncDeadLetter(operation.id));
    await syncNow();
  }, [busy, syncNow]);

  if (pendingCount === 0 && failedCount === 0) return null;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface.panel, borderColor: colors.border.default }]}>
      <View style={[styles.iconWrap, { backgroundColor: colors.accent.soft }]}>
        <Icon source={failedCount > 0 ? 'cloud-alert-outline' : 'cloud-sync-outline'} size={20} color={colors.accent.primary} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.text.primary }]}>{labels.title}</Text>
        <Text style={[styles.subtitle, { color: colors.text.tertiary }]}>
          {failedCount > 0
            ? t(labels.failed, { count: failedCount })
            : t(labels.pending, { count: pendingCount })}
        </Text>
      </View>
      <Pressable
        style={({ pressed }) => [
          styles.action,
          { backgroundColor: colors.accent.selectionBg, opacity: busy ? 0.55 : pressed ? 0.72 : 1 },
        ]}
        disabled={busy}
        onPress={failedCount > 0 ? retryFailed : syncNow}
      >
        <Text style={[styles.actionText, { color: colors.accent.primary }]}>
          {failedCount > 0 ? labels.retry : labels.syncNow}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    ...typography.label,
    fontWeight: '700',
  },
  subtitle: {
    ...typography.caption,
  },
  action: {
    minHeight: 36,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    ...typography.caption,
    fontWeight: '700',
  },
});

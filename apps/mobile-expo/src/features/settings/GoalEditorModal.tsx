import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Modal, Portal, Text, TextInput } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import { queryKeys } from '../../query/keys';
import {
  createUserGoal,
  updateUserGoal,
  type MobileGoalEditStatus,
  type MobileUserGoal,
} from '../../query/user-profile';
import { useGatewayStore } from '../../stores/gateway-store';
import { radii, spacing, typography, useTheme } from '../../theme';

function dateInput(timestamp?: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function GoalEditorModal({ goal, visible, onDismiss }: {
  goal?: MobileUserGoal; visible: boolean; onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const copy = useMessages().mobileExperience.goals;
  const client = useQueryClient();
  const gatewayId = useGatewayStore(state => state.activeGatewayId) ?? '';
  const [title, setTitle] = useState('');
  const [outcome, setOutcome] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [status, setStatus] = useState<MobileGoalEditStatus>('active');
  const [dateError, setDateError] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTitle(goal?.title ?? '');
    setOutcome(goal?.desiredOutcome ?? '');
    setTargetDate(dateInput(goal?.targetAt));
    setStatus(goal?.status ?? 'active');
    setDateError(false);
  }, [goal, visible]);

  const targetAt = useMemo(() => {
    if (!targetDate.trim()) return null;
    const parsed = Date.parse(`${targetDate.trim()}T23:59:59`);
    return Number.isFinite(parsed) ? parsed : undefined;
  }, [targetDate]);
  const canSave = Boolean(title.trim() && outcome.trim() && targetAt !== undefined);
  const mutation = useMutation({
    mutationFn: async () => {
      setDateError(targetAt === undefined);
      if (targetAt === undefined) throw new Error(copy.invalidDate);
      if (goal) {
        await updateUserGoal(goal.id, { title: title.trim(), desiredOutcome: outcome.trim(), targetAt, status });
      } else {
        await createUserGoal({
          title: title.trim(), desiredOutcome: outcome.trim(), ...(targetAt === null ? {} : { targetAt }),
        });
      }
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.userProfile(gatewayId) });
      onDismiss();
    },
  });

  return <Portal><Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={[
    styles.modal, { backgroundColor: colors.surface.panel },
  ]}>
    <Text style={[styles.heading, { color: colors.text.primary }]}>{goal ? copy.edit : copy.add}</Text>
    <Text style={[styles.help, { color: colors.text.secondary }]}>{copy.help}</Text>
    <TextInput mode="outlined" label={copy.titleLabel} value={title} maxLength={120} onChangeText={setTitle} />
    <TextInput mode="outlined" multiline label={copy.outcomeLabel} value={outcome} maxLength={600} onChangeText={setOutcome} />
    <TextInput
      mode="outlined" label={copy.targetDate} placeholder="YYYY-MM-DD" value={targetDate}
      error={dateError} onChangeText={(value) => { setTargetDate(value); setDateError(false); }}
    />
    {dateError ? <Text style={[styles.error, { color: colors.semantic.error }]}>{copy.invalidDate}</Text> : null}
    {goal ? <View style={styles.statusRow}>{(['active', 'paused', 'achieved'] as const).map(value => <Pressable
      key={value} accessibilityRole="button" onPress={() => setStatus(value)} style={[
        styles.statusChip,
        { backgroundColor: status === value ? colors.accent.soft : colors.surface.grouped, borderColor: status === value ? colors.accent.primary : colors.border.subtle },
      ]}
    ><Text style={{ color: status === value ? colors.accent.primary : colors.text.secondary }}>{copy[value]}</Text></Pressable>)}</View> : null}
    {mutation.isError && !dateError ? <Text style={[styles.error, { color: colors.semantic.error }]}>{copy.saveFailed}</Text> : null}
    <View style={styles.actions}>
      <Button onPress={onDismiss}>{copy.cancel}</Button>
      <Button mode="contained" disabled={!canSave} loading={mutation.isPending} onPress={() => mutation.mutate()}>{copy.save}</Button>
    </View>
  </Modal></Portal>;
}

const styles = StyleSheet.create({
  modal: { margin: spacing.xl, padding: spacing.xl, borderRadius: radii.xl, gap: spacing.md },
  heading: { ...typography.title },
  help: { ...typography.body },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statusChip: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radii.full, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  error: { ...typography.caption },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
});

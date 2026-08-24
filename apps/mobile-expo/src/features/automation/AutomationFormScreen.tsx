import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';

import { AppToast } from '../../components/AppToast';
import { ListSkeleton } from '../../components/ListSkeleton';
import { NativeScreenHeader } from '../../components/NativeScreenHeader';
import { TOAST_DURATION_DEFAULT } from '../../constants/toast';
import { useMessages } from '../../i18n/messages';
import {
  automationCronExpression,
  automationInstruction,
  createScheduledAgentAutomation,
  fetchAutomation,
  isMobileEditableAutomation,
  removeAutomation,
  updateScheduledAgentAutomation,
} from '../../query/automations';
import { queryKeys } from '../../query/keys';
import { useGatewayConfigured } from '../../query/sessions';
import { useTheme } from '../../theme';

import { CronSchedulePicker } from './CronSchedulePicker';
import {
  buildCronSchedule,
  DEFAULT_SCHEDULE,
  parseCronSchedule,
  type ScheduleState,
} from './cron-schedule';

export function AutomationFormScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const jobId = typeof id === 'string' ? id : undefined;
  const isEdit = Boolean(jobId);

  const configured = useGatewayConfigured();
  const { colors } = useTheme();
  const m = useMessages();
  const pm = m.automationForm;

  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [schedule, setSchedule] = useState<ScheduleState>(DEFAULT_SCHEDULE);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  const jobQuery = useQuery({
    queryKey: queryKeys.automation(jobId ?? ''),
    queryFn: () => fetchAutomation(jobId!),
    enabled: configured && isEdit,
  });

  useEffect(() => {
    const job = jobQuery.data;
    if (!job || !isEdit) return;
    if (!isMobileEditableAutomation(job)) return;
    setName(job.name.trim());
    setMessage(automationInstruction(job));
    setSchedule(parseCronSchedule(automationCronExpression(job)));
  }, [isEdit, jobQuery.data]);

  const canSubmit = name.trim().length > 0 && message.trim().length > 0;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const scheduleExpr = buildCronSchedule(schedule);
      if (isEdit && jobId) {
        await updateScheduledAgentAutomation(jobId, {
          name: name.trim(),
          cronExpression: scheduleExpr,
          instruction: message.trim(),
        });
        return jobId;
      }
      const created = await createScheduledAgentAutomation({
        name: name.trim(),
        cronExpression: scheduleExpr,
        instruction: message.trim(),
      });
      return created.id;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.automations });
      router.back();
    },
    onError: (error) => {
      setSnackbarMessage(error instanceof Error ? error.message : pm.saveFailed);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => removeAutomation(jobId!),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.automations });
      router.back();
    },
    onError: (error) => {
      setSnackbarMessage(error instanceof Error ? error.message : pm.deleteFailed);
    },
  });

  const confirmDelete = useCallback(() => {
    Alert.alert(pm.deleteTitle, pm.deleteMessage, [
      { text: m.common.cancel, style: 'cancel' },
      {
        text: pm.deleteConfirm,
        style: 'destructive',
        onPress: () => deleteMutation.mutate(),
      },
    ]);
  }, [deleteMutation, m.common.cancel, pm.deleteConfirm, pm.deleteMessage, pm.deleteTitle]);

  const screenBg = colors.surface.base;
  const textSecondary = colors.text.secondary;
  const title = isEdit ? pm.editTitle : pm.createTitle;

  if (isEdit && jobQuery.isLoading) {
    return (
      <View style={[styles.screen, { backgroundColor: screenBg }]}>
        <NativeScreenHeader title={title} onBack={() => router.back()} />
        <View style={styles.loading}><ListSkeleton count={4} /></View>
      </View>
    );
  }

  if (isEdit && jobQuery.isError) {
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: screenBg }]}>
        <NativeScreenHeader title={title} onBack={() => router.back()} />
        <Text style={{ color: textSecondary, marginBottom: 12 }}>{pm.loadFailed}</Text>
        <Button mode="outlined" onPress={() => void jobQuery.refetch()}>
          {m.common.retry}
        </Button>
      </View>
    );
  }

  if (isEdit && jobQuery.data && !isMobileEditableAutomation(jobQuery.data)) {
    return (
      <View style={[styles.screen, { backgroundColor: screenBg }]}>
        <NativeScreenHeader title={title} onBack={() => router.back()} />
        <View style={styles.center}>
          <Text style={{ color: textSecondary }}>{pm.notEditable}</Text>
          <Button mode="contained" onPress={() => router.replace(`/automation/${jobId}`)}>{pm.viewDetails}</Button>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: screenBg }]}>
      <NativeScreenHeader title={title} onBack={() => router.back()} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <Text style={[styles.hint, { color: textSecondary }]}>{pm.hint}</Text>

          <TextInput
            label={pm.nameLabel}
            mode="outlined"
            value={name}
            onChangeText={setName}
            maxLength={80}
          />

          <TextInput
            label={pm.messageLabel}
            mode="outlined"
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={5}
            style={styles.messageInput}
          />

          <CronSchedulePicker value={schedule} onChange={setSchedule} />

          <Button
            mode="contained"
            onPress={() => saveMutation.mutate()}
            loading={saveMutation.isPending}
            disabled={!canSubmit || saveMutation.isPending || deleteMutation.isPending}
          >
            {isEdit ? pm.save : pm.create}
          </Button>

          {isEdit ? (
            <Button
              mode="outlined"
              textColor={colors.semantic.error}
              onPress={confirmDelete}
              loading={deleteMutation.isPending}
              disabled={saveMutation.isPending || deleteMutation.isPending}
            >
              {pm.delete}
            </Button>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <AppToast visible={Boolean(snackbarMessage)} onDismiss={() => setSnackbarMessage('')} duration={TOAST_DURATION_DEFAULT}>
        {snackbarMessage}
      </AppToast>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 12 },
  loading: { padding: 20 },
  form: { paddingHorizontal: 20, paddingTop: 12, gap: 16, paddingBottom: 40 },
  hint: { fontSize: 13, lineHeight: 18 },
  messageInput: { minHeight: 120 },
});

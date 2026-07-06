import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';

import { AppToast } from '../../components/AppToast';
import { FloatingHeader } from '../../components/FloatingHeader';
import { TOAST_DURATION_DEFAULT } from '../../constants/toast';
import { useMessages } from '../../i18n/messages';
import {
  createCronJob,
  cronJobMessage,
  deleteCronJob,
  fetchCronJob,
  isEditableCronJob,
  updateCronJob,
} from '../../query/cron';
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

export function CronJobFormScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const jobId = typeof id === 'string' ? id : undefined;
  const isEdit = Boolean(jobId);

  const configured = useGatewayConfigured();
  const { colors } = useTheme();
  const m = useMessages();
  const pm = m.cronForm;

  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [schedule, setSchedule] = useState<ScheduleState>(DEFAULT_SCHEDULE);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  const jobQuery = useQuery({
    queryKey: queryKeys.cronJob(jobId ?? ''),
    queryFn: () => fetchCronJob(jobId!),
    enabled: configured && isEdit,
  });

  useEffect(() => {
    const job = jobQuery.data;
    if (!job || !isEdit) return;
    if (!isEditableCronJob(job)) {
      setSnackbarMessage(pm.notEditable);
      return;
    }
    setName(job.name?.trim() ?? '');
    setMessage(cronJobMessage(job));
    setSchedule(parseCronSchedule(job.schedule));
  }, [isEdit, jobQuery.data, pm.notEditable]);

  const canSubmit = name.trim().length > 0 && message.trim().length > 0;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const scheduleExpr = buildCronSchedule(schedule);
      if (isEdit && jobId) {
        await updateCronJob(jobId, {
          name: name.trim(),
          schedule: scheduleExpr,
          message: message.trim(),
        });
        return jobId;
      }
      const created = await createCronJob({
        name: name.trim(),
        schedule: scheduleExpr,
        message: message.trim(),
      });
      return created.id;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.cronJobs });
      router.back();
    },
    onError: (error) => {
      setSnackbarMessage(error instanceof Error ? error.message : pm.saveFailed);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteCronJob(jobId!),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.cronJobs });
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
  const notEditable = isEdit && jobQuery.data && !isEditableCronJob(jobQuery.data);

  const title = isEdit ? pm.editTitle : pm.createTitle;

  if (isEdit && jobQuery.isLoading) {
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: screenBg }]}>
        <FloatingHeader title={title} onBack={() => router.back()} />
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (isEdit && jobQuery.isError) {
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: screenBg }]}>
        <FloatingHeader title={title} onBack={() => router.back()} />
        <Text style={{ color: textSecondary, marginBottom: 12 }}>{pm.loadFailed}</Text>
        <Button mode="outlined" onPress={() => void jobQuery.refetch()}>
          {m.common.retry}
        </Button>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: screenBg }]}>
      <FloatingHeader title={title} onBack={() => router.back()} />

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
            editable={!notEditable}
          />

          <TextInput
            label={pm.messageLabel}
            mode="outlined"
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={5}
            style={styles.messageInput}
            editable={!notEditable}
          />

          <CronSchedulePicker value={schedule} onChange={setSchedule} />

          {notEditable ? (
            <Text style={[styles.warning, { color: colors.semantic.error }]}>{pm.notEditable}</Text>
          ) : (
            <Button
              mode="contained"
              onPress={() => saveMutation.mutate()}
              loading={saveMutation.isPending}
              disabled={!canSubmit || saveMutation.isPending || deleteMutation.isPending}
            >
              {isEdit ? pm.save : pm.create}
            </Button>
          )}

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
  center: { justifyContent: 'center', alignItems: 'center', padding: 32 },
  form: { padding: 16, gap: 16, paddingBottom: 40 },
  hint: { fontSize: 13, lineHeight: 18 },
  messageInput: { minHeight: 120 },
  warning: { fontSize: 13, lineHeight: 18 },
});

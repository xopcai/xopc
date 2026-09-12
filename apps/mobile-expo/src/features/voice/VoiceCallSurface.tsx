import { useEffect, useRef, useState } from 'react';
import { AppState, DeviceEventEmitter, Keyboard, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';

import { submitClarificationResponse } from '../../api/agent-client';
import { useMessages } from '../../i18n/messages';
import { respondVoiceApproval, voiceApprovalsOptions, VoiceRequestError } from '../../query/voice';
import { useGatewayStore } from '../../stores/gateway-store';
import { radii, spacing, typography, useTheme } from '../../theme';
import { CHAT_HEADER_HEIGHT_AFTER_SAFE_AREA } from '../chat/ChatHeader';
import { ClarifyPrompt } from '../chat/ClarifyPrompt';
import { setAppClipboardStringAsync } from '../clipboard-intake/write-app-clipboard';
import { subscribeNetworkChange } from '../gateway/network-info';

import { isCallPermissionPromptActive, setCallSpeaker, useVoiceCall, voiceCall } from './voice-call';
import { shouldPauseVoiceForBackground, shouldResumeVoiceAfterForeground } from './voice-call-controller';
import { voiceErrorMessage } from './voice-error';
import { VoiceCallOverlay } from './VoiceCallOverlay';
import { VoiceBrandMark, VoiceCompanion, type VoiceCompanionMood } from './VoiceCompanion';
import { useVoicePreferences } from './voice-preferences';

function approvalValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(approvalValue).filter(Boolean).join(', ');
  if (typeof value === 'object') return Object.values(value).map(approvalValue).filter(Boolean).join(', ');
  return '';
}

function CallElapsed({ startedAt, color, compact = false }: { startedAt: number; color: string; compact?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <Text style={[compact ? typography.caption : styles.elapsed, { color }]}>
      {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
    </Text>
  );
}

export function VoiceCallSurface() {
  const state = useVoiceCall();
  const { voice: m } = useMessages();
  const { colors, elevation } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const captions = useVoicePreferences((snapshot) => snapshot.captions);
  const [speaker, setSpeaker] = useState(false);
  const [diagnosticCopy, setDiagnosticCopy] = useState<'copied' | 'failed'>();
  const clarificationAttempt = useRef<{ signature: string; idempotencyKey: string } | undefined>(undefined);

  const approvalsEnabled = state.phase === 'connected' && state.mode === 'assistant' && Boolean(state.target);
  const approvals = useQuery({
    ...voiceApprovalsOptions(state.target?.gatewayId, state.target?.sessionKey),
    enabled: approvalsEnabled,
  });
  const pendingApprovals = approvalsEnabled ? approvals.data ?? [] : [];
  const pendingApproval = pendingApprovals[0];
  const approval = useMutation({
    mutationFn: ({ id, decision, sessionKey }: { id: string; decision: 'approved' | 'denied'; sessionKey: string }) =>
      respondVoiceApproval(id, decision, sessionKey),
    onSuccess: () => approvals.refetch(),
    retry: false,
  });
  const clarification = useMutation({
    mutationFn: ({ id, action, answer, version }: { id: string; action: 'answer' | 'agent_decide' | 'cancel'; answer?: string; version: number }) => {
      const signature = `${id}\n${version}\n${action}\n${answer ?? ''}`;
      let attempt = clarificationAttempt.current;
      if (attempt?.signature !== signature) {
        attempt = { signature, idempotencyKey: randomUUID() };
        clarificationAttempt.current = attempt;
      }
      return submitClarificationResponse(id, {
        action,
        answer,
        expectedVersion: version,
        idempotencyKey: attempt.idempotencyKey,
      });
    },
    onSuccess: (_, variables) => {
      clarificationAttempt.current = undefined;
      if (voiceCall.getSnapshot().clarification?.requestId === variables.id) voiceCall.confirmationSent();
    },
    retry: false,
  });
  const resetApproval = approval.reset;
  const resetClarification = clarification.reset;

  useEffect(() => {
    voiceCall.setApprovalPending(pendingApprovals.length > 0);
  }, [pendingApprovals.length]);
  useEffect(() => {
    clarificationAttempt.current = undefined;
    resetApproval();
    resetClarification();
    setDiagnosticCopy(undefined);
  }, [state.startedAt, resetApproval, resetClarification]);
  useEffect(() => {
    const consent = DeviceEventEmitter.addListener('voice-consent-revoked', () => void voiceCall.end());
    const app = AppState.addEventListener('change', (status) => {
      const current = voiceCall.getSnapshot();
      if (status === 'background' && shouldPauseVoiceForBackground(current, isCallPermissionPromptActive())) {
        void voiceCall.pause('background');
      } else if (status === 'active' && shouldResumeVoiceAfterForeground(current)) {
        void voiceCall.resume();
      }
    });
    const network = subscribeNetworkChange((snapshot) => voiceCall.setNetworkOnline(snapshot.online));
    const gateway = useGatewayStore.subscribe((next, previous) => {
      if (next.activeGatewayId !== previous.activeGatewayId || next.unauthorized) void voiceCall.end();
    });
    return () => {
      consent.remove();
      app.remove();
      network();
      gateway();
      void voiceCall.end();
    };
  }, []);
  useEffect(() => {
    if (state.phase === 'connecting' || state.phase === 'recovering') setSpeaker(false);
  }, [state.phase]);
  useEffect(() => {
    if (state.phase !== 'idle' && state.expanded) Keyboard.dismiss();
  }, [state.expanded, state.phase]);

  if (state.phase === 'idle') return null;

  const status = state.phase === 'connected'
    ? (state.clarification || pendingApprovals.length > 0)
      ? m.waiting
      : state.responseStage === 'speaking'
        ? m.speaking
        : state.activity
          ? m.working
          : state.responseStage === 'buffering'
            ? m.buffering
            : state.responseId
              ? m.thinking
              : m.connected
    : m[state.phase];
  const statusLabel = state.muted ? m.muted : status;
  const activeCaption = state.assistantText || state.userText;
  const statusColor = state.error
    ? colors.semantic.warning
    : state.phase === 'connected' && !state.muted
      ? colors.semantic.success
      : colors.text.tertiary;
  const hasInterruptAction = Boolean(state.responseId || state.taskId);
  const companionMood: VoiceCompanionMood = state.error || state.phase === 'paused' || state.phase === 'ending'
    ? 'offline'
    : state.phase === 'connecting' || state.phase === 'recovering'
      ? 'connecting'
      : state.muted || state.clarification || pendingApprovals.length > 0
        ? 'waiting'
        : state.responseStage === 'speaking'
          ? 'speaking'
          : state.responseId || state.activity || state.responseStage === 'buffering'
            ? 'thinking'
            : 'listening';

  const showChat = () => {
    voiceCall.expand(false);
    if (state.target) router.push(`/chat/${encodeURIComponent(state.target.sessionKey)}`);
  };
  const copyDiagnostics = () => {
    void setAppClipboardStringAsync(JSON.stringify(voiceCall.getDiagnostics(), null, 2))
      .then(() => setDiagnosticCopy('copied'))
      .catch(() => setDiagnosticCopy('failed'));
  };
  const interrupt = () => {
    if (state.taskId) voiceCall.cancelTask();
    else void voiceCall.stopReply();
  };

  return (
    <VoiceCallOverlay expanded={state.expanded} onClose={() => voiceCall.expand(false)}>
      {!state.expanded ? (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <View
            style={[
              styles.miniBar,
              {
                top: insets.top + CHAT_HEADER_HEIGHT_AFTER_SAFE_AREA + spacing.sm,
                backgroundColor: colors.surface.elevated,
                borderColor: colors.border.default,
              },
              elevation.overlay,
            ]}
          >
            <Pressable
              style={styles.miniBody}
              accessibilityRole="button"
              accessibilityLabel={m.expand}
              onPress={() => voiceCall.expand()}
            >
              <View style={[styles.miniAvatar, { borderColor: colors.border.subtle }]}>
                <VoiceBrandMark size={38} />
              </View>
              <View style={styles.grow}>
                <Text numberOfLines={1} style={[typography.label, { color: colors.text.primary }]}>
                  {state.name || m.title}
                </Text>
                <View style={styles.miniStatusRow}>
                  <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                  <Text numberOfLines={1} style={[typography.caption, { color: colors.text.secondary }]}>{statusLabel} ·</Text>
                  <CallElapsed compact startedAt={state.startedAt} color={colors.text.secondary} />
                </View>
              </View>
            </Pressable>
            <Pressable
              testID="voice-mini-end"
              style={[styles.miniEnd, { backgroundColor: colors.semantic.error }]}
              accessibilityRole="button"
              accessibilityLabel={m.end}
              onPress={() => void voiceCall.end()}
            >
              <Icon source="phone-hangup" size={20} color={colors.text.inverse} />
            </Pressable>
          </View>
        </View>
      ) : (
        <View
          testID="voice-call-screen"
          style={[
            styles.screen,
            { backgroundColor: colors.surface.base, paddingTop: insets.top, paddingBottom: insets.bottom },
          ]}
        >
          <View pointerEvents="none" style={[styles.tintTop, { backgroundColor: colors.accent.soft }]} />
          <View pointerEvents="none" style={[styles.tintBottom, { backgroundColor: colors.accent.selectionBg }]} />

          <View style={styles.header}>
            <Pressable
              style={[styles.headerIcon, { backgroundColor: colors.surface.grouped }]}
              accessibilityRole="button"
              accessibilityLabel={m.minimize}
              onPress={() => voiceCall.expand(false)}
            >
              <Icon source="chevron-down" size={24} color={colors.text.primary} />
            </Pressable>
            <View style={styles.grow} />
            <Pressable
              testID="voice-open-chat"
              style={({ pressed }) => [
                styles.chatButton,
                { backgroundColor: pressed ? colors.surface.pressed : colors.surface.grouped },
              ]}
              accessibilityRole="button"
              accessibilityLabel={m.returnChat}
              onPress={showChat}
            >
              <Icon source="message-text-outline" size={19} color={colors.text.primary} />
              <Text style={[typography.label, { color: colors.text.primary }]}>{m.returnChat}</Text>
            </Pressable>
          </View>

          <View style={styles.hero}>
            <VoiceCompanion mood={companionMood} size={172} />
            <Text style={[styles.agentName, typography.title, { color: colors.text.primary }]} numberOfLines={1}>
              {state.name || m.title}
            </Text>
            <View style={styles.statusRow} accessibilityLiveRegion="polite">
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[typography.ui, styles.statusText, { color: colors.text.secondary }]}>{statusLabel}</Text>
            </View>
            <CallElapsed startedAt={state.startedAt} color={colors.text.tertiary} />
          </View>

          <View style={styles.interactionSlot}>
            {state.clarification ? (
              <ScrollView
                style={styles.interventionScroll}
                contentContainerStyle={styles.interventionScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View style={[styles.interventionCard, { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle }]}>
                  <ClarifyPrompt
                    prompt={state.clarification}
                    submitting={clarification.isPending}
                    submitError={clarification.isError ? m.error : null}
                    onSubmit={(answer) => {
                      if (state.clarification) clarification.mutate({
                        id: state.clarification.requestId,
                        action: 'answer',
                        answer,
                        version: state.clarification.version,
                      });
                    }}
                    onAgentDecide={() => {
                      if (state.clarification) clarification.mutate({
                        id: state.clarification.requestId,
                        action: 'agent_decide',
                        version: state.clarification.version,
                      });
                    }}
                    onCancel={() => {
                      if (state.clarification) clarification.mutate({
                        id: state.clarification.requestId,
                        action: 'cancel',
                        version: state.clarification.version,
                      });
                    }}
                  />
                </View>
              </ScrollView>
            ) : pendingApproval ? (
              <View style={[styles.interventionCard, { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle }]}>
                <View style={styles.interventionHeading}>
                  <Icon source="shield-check-outline" size={20} color={colors.semantic.warning} />
                  <Text style={[typography.heading, styles.grow, { color: colors.text.primary }]}>{m.approval}</Text>
                  <Pressable accessibilityRole="button" onPress={showChat} hitSlop={6}>
                    <Text style={[typography.label, { color: colors.accent.primary }]}>{m.returnChat}</Text>
                  </Pressable>
                </View>
                <Text style={[typography.ui, { color: colors.text.primary }]} numberOfLines={1}>{pendingApproval.actionId}</Text>
                {Object.entries(pendingApproval.argumentsPreview).slice(0, 2).map(([key, value]) => {
                  const summary = approvalValue(value);
                  return summary ? (
                    <Text key={key} style={[typography.caption, { color: colors.text.secondary }]} numberOfLines={1}>
                      {key}: {summary}
                    </Text>
                  ) : null;
                })}
                <View style={styles.approvalActions}>
                  <Button
                    compact
                    disabled={approval.isPending}
                    onPress={() => approval.mutate({ id: pendingApproval.id, decision: 'denied', sessionKey: pendingApproval.sessionKey })}
                  >
                    {m.deny}
                  </Button>
                  <Button
                    compact
                    mode="contained"
                    disabled={approval.isPending}
                    onPress={() => approval.mutate({ id: pendingApproval.id, decision: 'approved', sessionKey: pendingApproval.sessionKey })}
                  >
                    {m.approve}
                  </Button>
                </View>
              </View>
            ) : state.phase === 'paused' || state.error ? (
              <View style={[styles.interventionCard, { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle }]}>
                <View style={styles.interventionHeading}>
                  <Icon source="alert-circle-outline" size={20} color={colors.semantic.warning} />
                  <Text accessibilityRole="alert" style={[typography.label, styles.grow, { color: colors.text.primary }]}>
                    {state.error ? voiceErrorMessage(state.error, m) : m.paused}
                  </Text>
                </View>
                <View style={styles.approvalActions}>
                  <Button compact onPress={copyDiagnostics}>{m.copyDiagnostics}</Button>
                  {state.phase === 'paused' ? (
                    <Button compact mode="contained" onPress={() => void voiceCall.resume()}>{m.resume}</Button>
                  ) : null}
                </View>
                {diagnosticCopy ? (
                  <Text accessibilityLiveRegion="polite" style={[typography.caption, { color: colors.text.tertiary }]}>
                    {diagnosticCopy === 'copied' ? m.diagnosticsCopied : m.diagnosticsCopyFailed}
                  </Text>
                ) : null}
              </View>
            ) : approvalsEnabled && approvals.isError ? (
              <View style={[styles.interventionCard, { backgroundColor: colors.surface.panel, borderColor: colors.border.subtle }]}>
                <Text accessibilityRole="alert" style={[typography.label, { color: colors.text.secondary }]}>
                  {approvals.error instanceof VoiceRequestError && approvals.error.status === 403
                    ? m.approvalPermission
                    : m.approvalLoadError}
                </Text>
                <Button compact loading={approvals.isFetching} onPress={() => void approvals.refetch()}>{m.refreshApprovals}</Button>
              </View>
            ) : captions && activeCaption ? (
              <Text style={[styles.captionPreview, typography.body, { color: colors.text.secondary }]} numberOfLines={3}>
                {activeCaption}
              </Text>
            ) : (
              <Text style={[typography.body, { color: colors.text.secondary }]}>{m.recording}</Text>
            )}
          </View>

          <View style={styles.interruptSlot}>
            {hasInterruptAction ? (
              <Pressable
                testID="voice-interrupt"
                style={({ pressed }) => [
                  styles.interruptButton,
                  {
                    backgroundColor: pressed ? colors.surface.pressed : colors.surface.grouped,
                    borderColor: colors.border.subtle,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={state.taskId ? m.cancelTask : m.stopReply}
                disabled={state.taskStage === 'cancelling'}
                onPress={interrupt}
              >
                <Icon source="stop" size={15} color={colors.text.secondary} />
                <Text style={[typography.label, { color: colors.text.secondary }]}>
                  {state.taskId ? m.cancelTask : m.stopReply}
                </Text>
              </Pressable>
            ) : state.phase === 'connected' && state.expiresAt && state.expiresAt - Date.now() < 60_000 ? (
              <Text accessibilityLiveRegion="polite" style={[typography.caption, { color: colors.text.tertiary }]}>{m.endingSoon}</Text>
            ) : null}
          </View>

          <View style={styles.controls}>
            <Pressable
              testID="voice-toggle-mute"
              disabled={state.phase === 'ending'}
              onPress={() => void voiceCall.setMuted(!state.muted)}
              style={styles.control}
              accessibilityRole="button"
              accessibilityLabel={state.muted ? m.unmute : m.mute}
            >
              <View style={[styles.controlCircle, { backgroundColor: state.muted ? colors.accent.soft : colors.surface.grouped }]}>
                <Icon source={state.muted ? 'microphone-off' : 'microphone'} size={27} color={colors.text.primary} />
              </View>
              <Text style={[styles.controlLabel, { color: colors.text.secondary }]}>{state.muted ? m.unmute : m.mute}</Text>
            </Pressable>
            <Pressable
              testID="voice-toggle-speaker"
              disabled={state.phase !== 'connected'}
              onPress={() => {
                void setCallSpeaker(!speaker)
                  .then(() => setSpeaker(!speaker))
                  .catch(() => voiceCall.pause('route_lost'));
              }}
              style={[styles.control, state.phase !== 'connected' && styles.disabled]}
              accessibilityRole="button"
              accessibilityLabel={speaker ? m.speaker : m.systemOutput}
            >
              <View style={[styles.controlCircle, { backgroundColor: speaker ? colors.accent.soft : colors.surface.grouped }]}>
                <Icon source={speaker ? 'volume-high' : 'volume-medium'} size={27} color={colors.text.primary} />
              </View>
              <Text style={[styles.controlLabel, { color: colors.text.secondary }]}>{speaker ? m.speaker : m.systemOutput}</Text>
            </Pressable>
            <Pressable
              testID="voice-end"
              onPress={() => void voiceCall.end()}
              style={styles.control}
              accessibilityRole="button"
              accessibilityLabel={m.end}
            >
              <View style={[styles.controlCircle, styles.endCircle, { backgroundColor: colors.semantic.error }]}>
                <Icon source="phone-hangup" size={29} color={colors.text.inverse} />
              </View>
              <Text style={[styles.controlLabel, { color: colors.text.secondary }]}>{m.end}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </VoiceCallOverlay>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, overflow: 'hidden' },
  grow: { flex: 1 },
  tintTop: {
    position: 'absolute',
    width: 340,
    height: 340,
    borderRadius: 170,
    top: -160,
    right: -130,
    opacity: 0.72,
  },
  tintBottom: {
    position: 'absolute',
    width: 380,
    height: 380,
    borderRadius: 190,
    bottom: -220,
    left: -180,
    opacity: 0.52,
  },
  header: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  headerIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  chatButton: {
    minHeight: 42,
    borderRadius: 21,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  hero: { flex: 1, minHeight: 260, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  agentName: { maxWidth: '86%', marginTop: spacing.xl, textAlign: 'center' },
  statusRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { minWidth: 160, textAlign: 'center' },
  elapsed: { ...typography.caption, fontVariant: ['tabular-nums'], marginTop: spacing.xs },
  interactionSlot: {
    minHeight: 92,
    maxHeight: 250,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  interventionScroll: { flexGrow: 0 },
  interventionScrollContent: { paddingVertical: spacing.xxs },
  interventionCard: {
    alignSelf: 'stretch',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  interventionHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  approvalActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm },
  captionPreview: { textAlign: 'center' },
  interruptSlot: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  interruptButton: {
    minHeight: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  controls: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  control: { width: 88, alignItems: 'center', gap: spacing.sm },
  controlCircle: { width: 66, height: 66, borderRadius: 33, alignItems: 'center', justifyContent: 'center' },
  endCircle: { width: 70, height: 70, borderRadius: 35 },
  controlLabel: { ...typography.caption, textAlign: 'center' },
  disabled: { opacity: 0.42 },
  miniBar: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
  },
  miniBody: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  miniAvatar: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  miniStatusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  miniEnd: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});

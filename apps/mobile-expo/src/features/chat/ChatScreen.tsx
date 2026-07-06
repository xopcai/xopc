/**
 * Chat detail screen — renders the existing chat UI.
 *
 * Route: /chat/[k] where k is the session key.
 * Query param `msg` can prefill a first message.
 *
 * Delegates to `useChatPage()` which reads route params via
 * `useLocalSearchParams`.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedStyle } from 'react-native-reanimated';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { Banner, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppToast } from '../../components/AppToast';
import { GlobalConnectionStatusBar } from '../gateway/GlobalConnectionStatusBar';
import { RouteOverrideToastView } from '../gateway/RouteOverrideToastView';
import { TOAST_BOTTOM_LIFT_ABOVE_BAR, TOAST_DURATION_DEFAULT, TOAST_DURATION_STATUS } from '../../constants/toast';
import { t } from '../../i18n/messages';
import { queryKeys } from '../../query/keys';
import { FLOATING_BOTTOM_OFFSET, floatingBottomPadding } from '../../theme';

import { AgentPickerSheet } from './AgentPickerSheet';
import { ChatComposer } from './ChatComposer';
import { ChatHeader } from './ChatHeader';
import { ChatOverlayDismissHandle } from './ChatOverlayDismissHandle';
import { ChatStreamNotice } from './ChatStreamNotice';
import { ClarifyPrompt } from './ClarifyPrompt';
import { GatewayPickerSheet } from './GatewayPickerSheet';
import { GoalMissionCard } from './GoalMissionCard';
import { MessageList } from './MessageList';
import { MAX_PENDING_FOLLOW_UPS } from './pending-follow-up.types';
import { appendOlderSessionHistoryPage } from './session-message-parser';
import { useChatPage } from './use-chat-page';
import { useOptionalWorkspaceTransition } from '../workspace/workspace-transition-context';

const AnimatedView = Animated.createAnimatedComponent(View);

export type ChatScreenProps = {
  embedded?: boolean;
  overlay?: boolean;
  onRequestHome?: () => void;
};

export function ChatScreen({ embedded = false, overlay = false, onRequestHome }: ChatScreenProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const transition = useOptionalWorkspaceTransition();
  const isShellEmbedded = embedded || overlay;
  const page = useChatPage({ embedded: isShellEmbedded, onBack: onRequestHome });
  const {
    sessionKey,
    urlSessionKey,
    isDark,
    colors,
    keyboardVisible,
    m,
    agentsQuery,
    modelsQuery,
    sessionHistoryQuery,
    currentSessionAgentId,
    effectiveModelId,
    agentName,
    modelName,
    displayMessages,
    chatSuggestions,
    isEmptyChat,
    composerDisabled,
    composerSuggestion,
    setComposerSuggestion,
    composerPrefillAttachments,
    setComposerPrefillAttachments,
    bootstrap,
    chat,
    gatewayProfiles,
    activeGatewayId,
    gatewayOnline,
    routeSwitchToast,
    routeOverrideToast,
    agentSheetVisible,
    setAgentSheetVisible,
    gatewaySheetVisible,
    setGatewaySheetVisible,
    switchingGatewayId,
    handleBack,
    openAgentsPicker,
    openReconnectLanding,
    handleModelSelect,
    handleAgentSelect,
    handleNewChat,
    handleStarterSend,
    handleGoalShortcutPress,
    handleComposerSend,
    handleUserMessageCopy,
    handleUserMessageEdit,
    handleAssistantCopy,
    handleAssistantRegenerate,
    handleGatewaySelect,
    handleGatewayManageSettings,
    handleGatewayAdd,
  } = page;

  const headerPaddingTop = insets.top + (overlay ? 0 : 8);
  const canvasBg = colors.surface.base;

  const headerRevealStyle = useAnimatedStyle(() => {
    if (!overlay || !transition) return { opacity: 1, transform: [{ translateY: 0 }] };
    const t = transition.progress.value;
    return {
      opacity: interpolate(t, [0.45, 0.85], [0, 1], Extrapolation.CLAMP),
      transform: [{ translateY: interpolate(t, [0.45, 0.85], [10, 0], Extrapolation.CLAMP) }],
    };
  }, [overlay, transition]);

  const bodyRevealStyle = useAnimatedStyle(() => {
    if (!overlay || !transition) return { opacity: 1, transform: [{ translateY: 0 }] };
    const t = transition.progress.value;
    return {
      opacity: interpolate(t, [0.55, 0.92], [0, 1], Extrapolation.CLAMP),
      transform: [{ translateY: interpolate(t, [0.55, 0.92], [14, 0], Extrapolation.CLAMP) }],
    };
  }, [overlay, transition]);

  return (
    <View style={[styles.screen, { backgroundColor: canvasBg }]}>
      {overlay ? <ChatOverlayDismissHandle /> : null}
      <AnimatedView style={headerRevealStyle}>
        <ChatHeader
          agentName={agentName}
          modelName={modelName}
          models={modelsQuery.data?.items ?? []}
          currentModelId={effectiveModelId}
          paddingTop={headerPaddingTop}
          headerBg={colors.surface.base}
          pillText={colors.text.primary}
          pillMuted={colors.text.tertiary}
          onBackPress={overlay ? onRequestHome : isShellEmbedded ? undefined : handleBack}
          onAgentPress={openAgentsPicker}
          onModelSelect={handleModelSelect}
          onFilesPress={sessionKey ? () => router.push(`/files?sessionKey=${encodeURIComponent(sessionKey)}`) : undefined}
          onNewChat={handleNewChat}
        />
      </AnimatedView>

      <GlobalConnectionStatusBar
        onOpenSettings={handleGatewayManageSettings}
        onReconnect={openReconnectLanding}
      />

      <View style={[styles.chatBody, { backgroundColor: canvasBg }]}>
        <AnimatedView style={[styles.chatBodyInner, bodyRevealStyle]}>
        {!urlSessionKey && bootstrap.bootstrapError ? (
          <Banner
            visible
            icon="alert"
            actions={[{ label: m.common.retry, onPress: bootstrap.retryBootstrapSession }]}
          >
            {bootstrap.bootstrapError}
          </Banner>
        ) : null}
        {!urlSessionKey && bootstrap.creatingInitialSession ? (
          <View style={styles.bootstrapRow}>
            <ActivityIndicator size="small" />
            <Text variant="bodySmall" style={{ opacity: 0.65 }}>{m.common.loading}</Text>
          </View>
        ) : null}

        <ChatStreamNotice
          isDark={isDark}
          reconnecting={chat.streamReconnecting}
          reconnectingLabel={m.chat.streamReconnecting}
          resumeVisible={!chat.streaming && chat.resumePromptVisible && !chat.streamReconnecting}
          resumeLabel={m.chat.resumeBanner}
          resumeActionLabel={m.chat.resumeButton}
          onResume={() => { void chat.resume({ background: true }); }}
        />

        <GoalMissionCard
          sessionKey={sessionKey}
          agentBusy={chat.streaming || chat.awaitingSessionRefresh}
        />

        <View style={styles.listFill}>
          <MessageList
            messages={displayMessages}
            streaming={chat.streaming}
            progress={chat.progress}
            loading={sessionHistoryQuery.isLoading || (!sessionKey && bootstrap.creatingInitialSession)}
            loadingOlder={sessionHistoryQuery.isFetchingNextPage}
            hasOlder={sessionHistoryQuery.hasNextPage}
            onLoadOlder={() => {
              if (!sessionHistoryQuery.hasNextPage || sessionHistoryQuery.isFetchingNextPage) return;
              const loadedPages = sessionHistoryQuery.data?.pages ?? [];
              const lastLoadedPage = loadedPages[loadedPages.length - 1];
              const olderCursor = lastLoadedPage?.pagination.nextBeforeCursor;
              if (!olderCursor) { void sessionHistoryQuery.fetchNextPage(); return; }

              const prefetchedOlderPage = queryClient.getQueryData(
                queryKeys.sessionHistoryOlderPreview(sessionKey, olderCursor),
              );

              if (prefetchedOlderPage) {
                queryClient.setQueryData(
                  queryKeys.sessionHistory(sessionKey),
                  (oldData) => appendOlderSessionHistoryPage(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    oldData as any,
                    prefetchedOlderPage as Parameters<typeof appendOlderSessionHistoryPage>[1],
                    olderCursor,
                  ),
                );
                return;
              }

              void sessionHistoryQuery.fetchNextPage();
            }}
            onAtBottomChange={(isAtBottom) => { chat.messageListAtBottomRef.current = isAtBottom; }}
            sessionKey={sessionKey}
            welcomeTitle={m.chat.welcomeTitle}
            welcomeSubtitle={m.chat.welcomeSubtitle}
            suggestions={chatSuggestions}
            onSuggestionSend={handleStarterSend}
            onUserMessageCopy={handleUserMessageCopy}
            onUserMessageEdit={handleUserMessageEdit}
            onAssistantCopy={handleAssistantCopy}
            onAssistantRegenerate={handleAssistantRegenerate}
            networkUnreachableTip={null}
          />
        </View>

        <KeyboardStickyView
          offset={{ closed: 0, opened: 0 }}
          style={{
            backgroundColor: canvasBg,
            marginBottom: FLOATING_BOTTOM_OFFSET,
            paddingBottom: floatingBottomPadding(insets.bottom),
          }}
        >
          <ClarifyPrompt
            prompt={chat.clarifyPrompt}
            submitting={chat.clarifySubmitting}
            submitError={chat.clarifySubmitError}
            onSubmit={(answer) => void chat.submitClarifyAnswer(answer)}
            onSkip={() => void chat.skipClarifyAnswer()}
          />
          <ChatComposer
            sessionKey={sessionKey}
            disabled={composerDisabled}
            streaming={chat.streaming}
            onPressGoalShortcut={isEmptyChat ? handleGoalShortcutPress : undefined}
            onSend={handleComposerSend}
            keyboardVisible={keyboardVisible}
            onSendVoice={(payload) => void chat.sendVoice(payload)}
            onAbort={chat.abort}
            placeholder={m.chat.inputPlaceholder}
            suggestionDraft={composerSuggestion}
            onConsumeSuggestionDraft={() => setComposerSuggestion(undefined)}
            prefillAttachments={composerPrefillAttachments}
            onConsumePrefillAttachments={() => setComposerPrefillAttachments(undefined)}
            onAddPendingFollowUp={(text, atts) => chat.followUp.addPendingFollowUp(text, atts)}
            pendingFollowUps={chat.followUp.pendingFollowUps}
            editingFollowUpId={chat.followUp.editingFollowUpId}
            onBeginEditFollowUp={chat.followUp.beginEditFollowUp}
            onCancelEditFollowUp={chat.followUp.cancelEditFollowUp}
            onCommitEditFollowUp={chat.followUp.commitEditFollowUp}
            onPendingFollowUpRemove={chat.followUp.removePendingFollowUp}
            onPendingFollowUpMove={chat.followUp.movePendingFollowUp}
            onPendingFollowUpSteer={(id) => void chat.followUp.steerPendingFollowUp(id)}
            steeringFollowUpId={chat.followUp.steeringFollowUpId}
            onQueueFull={() => chat.setSnackMsg(t(m.chat.followUpQueueMaxReached, { max: MAX_PENDING_FOLLOW_UPS }))}
            overlayShell={overlay}
          />
        </KeyboardStickyView>
        </AnimatedView>
      </View>

      <AppToast
        visible={Boolean(chat.snackMsg)}
        onDismiss={() => chat.setSnackMsg('')}
        duration={TOAST_DURATION_DEFAULT}
        bottomLift={TOAST_BOTTOM_LIFT_ABOVE_BAR}
      >
        {chat.snackMsg}
      </AppToast>

      <AppToast
        key={routeSwitchToast?.key ?? 'none'}
        visible={Boolean(routeSwitchToast)}
        onDismiss={() => { /* hook auto-clears */ }}
        duration={TOAST_DURATION_STATUS}
        bottomLift={TOAST_BOTTOM_LIFT_ABOVE_BAR}
      >
        {routeSwitchToast?.message ?? ''}
      </AppToast>

      <RouteOverrideToastView
        toast={routeOverrideToast}
        onDismiss={() => { /* hook auto-clears */ }}
      />

      <AgentPickerSheet
        visible={agentSheetVisible}
        agents={agentsQuery.data?.items ?? []}
        currentAgentId={currentSessionAgentId}
        onSelect={handleAgentSelect}
        onDismiss={() => setAgentSheetVisible(false)}
      />
      <GatewayPickerSheet
        visible={gatewaySheetVisible}
        profiles={gatewayProfiles}
        activeGatewayId={activeGatewayId}
        gatewayOnline={gatewayOnline}
        switchingId={switchingGatewayId}
        onSelect={(id) => void handleGatewaySelect(id)}
        onManageSettings={handleGatewayManageSettings}
        onAddGateway={handleGatewayAdd}
        onDismiss={() => setGatewaySheetVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  chatBody: { flex: 1, minHeight: 0 },
  chatBodyInner: { flex: 1, minHeight: 0 },
  bootstrapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  listFill: { flex: 1, minHeight: 0 },
});

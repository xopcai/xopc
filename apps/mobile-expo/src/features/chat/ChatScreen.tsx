/** Chat-first root and session detail surface. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { Icon, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConnectionInterventionBanner } from '../gateway/ConnectionInterventionBanner';
import { TOAST_BOTTOM_LIFT_ABOVE_BAR, TOAST_DURATION_DEFAULT } from '../../constants/toast';
import { queryKeys } from '../../query/keys';
import { voiceStatusOptions } from '../../query/voice';
import { usePreferencesStore } from '../../stores/preferences-store';
import { FLOATING_BOTTOM_OFFSET, floatingBottomPadding } from '../../theme';

import { AgentPickerSheet } from './AgentPickerSheet';
import { ChatComposer } from './ChatComposer';
import { ChatContextControl } from './ChatContextControl';
import { ChatHeader, CHAT_HEADER_TOP_PADDING_AFTER_SAFE_AREA } from './ChatHeader';
import { ChatNavigationSheet } from './ChatNavigationSheet';
import { StaticLoadingIndicator } from './StaticLoadingIndicator';
import { StaticChatToast } from './StaticChatToast';
import { ContinuousReadAloudBar } from './ContinuousReadAloudBar';
import { ClarifyPrompt } from './ClarifyPrompt';
import { MessageList } from './MessageList';
import { appendOlderSessionHistoryPage } from './session-message-parser';
import { useChatPage } from './use-chat-page';
import { useAutoReadAloud } from './use-auto-read-aloud';
import type { ComposerContextRef } from './composer.types';
import type { ComposerVoiceCallMode } from './composer-voice-call-options';
import { dispatchMobileComposerAppend } from './mobile-composer-fill';
import { useReadAloudStore } from '../voice/read-aloud-store';
import { useVoiceCall, voiceCall } from '../voice/voice-call';
import { useVoicePreferences } from '../voice/voice-preferences';
import { ChatAttentionTray } from '../attention/ChatAttentionTray';
import { useAttentionFeed } from '../attention/use-attention-feed';

export type ChatScreenProps = {
  root?: boolean;
};

export function ChatScreen({ root = false }: ChatScreenProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const page = useChatPage({ root });
  const [composerContextRefs, setComposerContextRefs] = useState<ComposerContextRef[]>([]);
  const [navigationVisible, setNavigationVisible] = useState(false);
  const {
    sessionKey,
    urlSessionKey,
    colors,
    keyboardVisible,
    m,
    agentsQuery,
    modelsQuery,
    sessionHistoryQuery,
    recentSessionsQuery,
    currentSessionAgentId,
    effectiveModelId,
    agentName,
    modelName,
    displayMessages,
    reasoningLevel,
    sessionPresentationReady,
    welcomeModel,
    composerDisabled,
    composerSuggestion,
    setComposerSuggestion,
    bootstrap,
    chat,
    activeGatewayId,
    agentSheetVisible,
    setAgentSheetVisible,
    handleBack,
    openAgentsPicker,
    openReconnectLanding,
    handleModelSelect,
    handleAgentSelect,
    handleNewChat,
    handleSessionSelect,
    handleContextChange,
    handleStarterPrefill,
    handleComposerSend,
    handleUserMessageCopy,
    handleUserMessageEdit,
    handleUserMessageRetry,
    handleAssistantCopy,
    handleAssistantSaveToNote,
    handleAssistantRegenerate,
    handleGatewayManageSettings,
  } = page;
  const language = usePreferencesStore((state) => state.language);
  const call = useVoiceCall();
  const voiceCallBackground = useVoicePreferences((state) => state.background);
  const voiceStatusQuery = useQuery({
    ...voiceStatusOptions(activeGatewayId),
    enabled: Boolean(activeGatewayId && sessionKey),
  });
  const attentionQuery = useAttentionFeed();
  const attentionItems = attentionQuery.data?.needsUser ?? [];

  useAutoReadAloud({
    language,
    messages: displayMessages,
    sessionKey,
    streaming: chat.streaming,
    title: m.chat.messageReadAloudTitle,
  });

  const handleVoiceCallPress = useCallback((mode: ComposerVoiceCallMode) => {
    if (call.phase !== 'idle') {
      voiceCall.expand();
      return;
    }
    if (!activeGatewayId || !sessionKey || composerDisabled || chat.streaming) return;
    const readAloud = useReadAloudStore.getState();
    readAloud.disableContinuous();
    readAloud.stop();
    void voiceCall.start({
      gatewayId: activeGatewayId,
      sessionKey,
      mode,
      background: voiceCallBackground,
      identity: sessionHistoryQuery.data?.pages[0]?.session.sessionId,
      name: sessionHistoryQuery.data?.pages[0]?.session.name ?? agentName,
    });
  }, [activeGatewayId, agentName, call.phase, chat.streaming, composerDisabled, sessionHistoryQuery.data?.pages, sessionKey, voiceCallBackground]);

  const headerPaddingTop = insets.top + CHAT_HEADER_TOP_PADDING_AFTER_SAFE_AREA;
  const canvasBg = colors.surface.base;

  return (
    <View style={[styles.screen, { backgroundColor: canvasBg }]}>
      <ChatHeader
        agentName={agentName}
          modelName={modelName}
          models={modelsQuery.data?.items ?? []}
          currentModelId={effectiveModelId}
          paddingTop={headerPaddingTop}
          pillText={colors.text.primary}
          onBackPress={root ? undefined : handleBack}
          onNavigationPress={root ? () => setNavigationVisible(true) : undefined}
          onAgentPress={openAgentsPicker}
          onModelSelect={handleModelSelect}
          onFilesPress={sessionKey ? () => router.push(`/files/context/session/${encodeURIComponent(sessionKey)}` as never) : undefined}
          onNewChat={handleNewChat}
      />

      <ConnectionInterventionBanner
        onOpenSettings={handleGatewayManageSettings}
        onReconnect={openReconnectLanding}
      />


      <View style={[styles.chatBody, { backgroundColor: canvasBg }]}>
        <View style={styles.chatBodyInner}>
        {!urlSessionKey && bootstrap.bootstrapError ? (
          <View style={[styles.bootstrapError, { borderColor: colors.semantic.error }]}>
            <Icon source="alert" size={18} color={colors.semantic.errorBold} />
            <Text style={[styles.bootstrapErrorText, { color: colors.semantic.errorBold }]}>
              {bootstrap.bootstrapError}
            </Text>
            <Pressable accessibilityRole="button" onPress={bootstrap.retryBootstrapSession}>
              <Text style={{ color: colors.accent.primary }}>{m.common.retry}</Text>
            </Pressable>
          </View>
        ) : null}
        {!urlSessionKey && bootstrap.creatingInitialSession ? (
          <View style={styles.bootstrapRow}>
            <StaticLoadingIndicator size={16} />
            <Text variant="bodySmall" style={{ opacity: 0.65 }}>{m.common.loading}</Text>
          </View>
        ) : null}

        <View style={styles.listFill}>
          <MessageList
            messages={displayMessages}
            reasoningLevel={reasoningLevel}
            streaming={chat.streaming}
            progress={chat.progress}
            loading={
              sessionHistoryQuery.isLoading
              || !sessionPresentationReady
              || (!sessionKey && bootstrap.creatingInitialSession)
            }
            loadError={sessionHistoryQuery.isError ? {
              message: m.chat.historyLoadFailed,
              retryLabel: m.common.retry,
              onRetry: () => { void sessionHistoryQuery.refetch(); },
            } : null}
            loadingOlder={sessionHistoryQuery.isFetchingNextPage}
            hasOlder={sessionHistoryQuery.hasNextPage}
            onLoadOlder={() => {
              if (!sessionHistoryQuery.hasNextPage || sessionHistoryQuery.isFetchingNextPage) return;
              const loadedPages = sessionHistoryQuery.data?.pages ?? [];
              const lastLoadedPage = loadedPages[loadedPages.length - 1];
              const olderCursor = lastLoadedPage?.pagination.nextBeforeCursor;
              if (!olderCursor) { void sessionHistoryQuery.fetchNextPage(); return; }

              const prefetchedOlderPage = queryClient.getQueryData(
                queryKeys.sessionHistoryOlderPreview(sessionKey, olderCursor, activeGatewayId),
              );

              if (prefetchedOlderPage) {
                queryClient.setQueryData(
                  queryKeys.sessionHistory(sessionKey, activeGatewayId),
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
            welcomeTitle={welcomeModel.headline}
            welcomeSubtitle={welcomeModel.tagline}
            welcomeStarters={welcomeModel.starters}
            onSuggestionSend={handleStarterPrefill}
            onUserMessageCopy={handleUserMessageCopy}
            onUserMessageEdit={handleUserMessageEdit}
            onUserMessageRetry={handleUserMessageRetry}
            onAssistantCopy={handleAssistantCopy}
            onAssistantSaveToNote={handleAssistantSaveToNote}
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
          <ContinuousReadAloudBar sessionKey={sessionKey} />
          <ClarifyPrompt
            prompt={chat.clarifyPrompt}
            submitting={chat.clarifySubmitting}
            submitError={chat.clarifySubmitError}
            onSubmit={(answer) => void chat.submitClarifyAnswer(answer)}
            onAgentDecide={() => void chat.letAgentDecideClarification()}
            onCancel={() => void chat.cancelClarification()}
          />
          {!chat.clarifyPrompt ? (
            <ChatAttentionTray gatewayId={activeGatewayId} items={attentionItems} />
          ) : null}
          <ChatComposer
            contextControl={sessionKey ? <ChatContextControl
              sessionKey={sessionKey}
              draftRefs={composerContextRefs}
              onRemoveDraftRef={(sourceId) => setComposerContextRefs((refs) => refs.filter((ref) => ref.sourceId !== sourceId))}
              onAddSource={() => dispatchMobileComposerAppend('@')}
              onChangeScope={handleContextChange}
            /> : null}
            sessionKey={sessionKey}
            disabled={composerDisabled}
            streaming={chat.streaming}
            onSend={handleComposerSend}
            keyboardVisible={keyboardVisible}
            onAbort={chat.abort}
            placeholder={m.chat.inputPlaceholder}
            suggestionDraft={composerSuggestion}
            onConsumeSuggestionDraft={() => setComposerSuggestion(undefined)}
            contextRefs={composerContextRefs}
            onContextRefsChange={setComposerContextRefs}
            onVoiceCallStart={handleVoiceCallPress}
            voiceCallUnavailable={{
              natural: Boolean(voiceStatusQuery.data && !voiceStatusQuery.data.capabilities.natural.available),
              assistant: Boolean(voiceStatusQuery.data && !voiceStatusQuery.data.capabilities.assistant.available),
            }}
          />
        </KeyboardStickyView>
        </View>
      </View>

      <StaticChatToast
        visible={Boolean(chat.snackMsg)}
        onDismiss={() => chat.setSnackMsg('')}
        duration={TOAST_DURATION_DEFAULT}
        bottomLift={TOAST_BOTTOM_LIFT_ABOVE_BAR}
      >
        {chat.snackMsg}
      </StaticChatToast>

      <AgentPickerSheet
        visible={agentSheetVisible}
        agents={agentsQuery.data?.items ?? []}
        currentAgentId={currentSessionAgentId}
        onSelect={handleAgentSelect}
        onDismiss={() => setAgentSheetVisible(false)}
      />
      <ChatNavigationSheet
        visible={navigationVisible}
        onDismiss={() => setNavigationVisible(false)}
        currentSessionKey={sessionKey}
        recentSessions={recentSessionsQuery.data?.items ?? []}
        attentionCount={attentionItems.length}
        onSessionSelect={handleSessionSelect}
        onNewChat={handleNewChat}
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
  bootstrapError: {
    minHeight: 48,
    marginHorizontal: 12,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bootstrapErrorText: { flex: 1 },
  listFill: { flex: 1, minHeight: 0 },
});

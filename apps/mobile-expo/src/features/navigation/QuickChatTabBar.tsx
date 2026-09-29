import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';

import { AppToast } from '../../components/AppToast';
import { useMessages } from '../../i18n/messages';
import { createSession } from '../../query/sessions';
import { useGatewayStore } from '../../stores/gateway-store';
import { radii, spacing, useTheme } from '../../theme';
import { ChatComposer } from '../chat/ChatComposer';
import { useComposerHandoff } from '../chat/composer-handoff';
import type { ComposerContextRef, WireAttachment } from '../chat/composer.types';
import type { ComposerVoiceCallMode } from '../chat/composer-voice-call-options';
import { openRootChat } from '../chat/open-root-chat';
import { CapsuleTabBar } from './CapsuleTabBar';
import { useChatChromeStore } from './chat-chrome-store';

function placeholderForRoute(
  route: string,
  copy: ReturnType<typeof useMessages>['mobileExperience'],
): string {
  if (route === 'progress') return copy.quickChatProgressPlaceholder;
  if (route === 'library') return copy.quickChatLibraryPlaceholder;
  if (route === 'settings') return copy.quickChatPersonalPlaceholder;
  return copy.quickChatConversationsPlaceholder;
}

/** Shared quick intake for every non-Assistant primary tab. */
export function QuickChatTabBar(props: BottomTabBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { colors, elevation } = useTheme();
  const copy = useMessages().mobileExperience;
  const gatewayId = useGatewayStore(state => state.activeGatewayId);
  const configured = useGatewayStore(state => state.getActiveProfile() !== null);
  const actionsOpen = useChatChromeStore(state => state.actionPanelOpen);
  const setActionsOpen = useChatChromeStore(state => state.setActionPanelOpen);
  const [contextRefs, setContextRefs] = useState<ComposerContextRef[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const route = props.state.routes[props.state.index]?.name ?? 'sessions';
  const composerScope = `quick-chat:${gatewayId ?? 'disconnected'}`;
  const showsComposer = ['/sessions', '/progress', '/library', '/settings'].includes(pathname);

  useEffect(() => {
    setActionsOpen(false);
  }, [route, setActionsOpen]);

  const createAndOpen = useCallback(async (payload?: {
    text?: string;
    attachments?: WireAttachment[];
    contextRefs?: ComposerContextRef[];
    autoSend?: boolean;
    voiceCallMode?: ComposerVoiceCallMode;
  }): Promise<boolean> => {
    if (!gatewayId || submitting) return false;
    setSubmitting(true);
    setError('');
    try {
      const conversationId = await createSession();
      if (payload) {
        useComposerHandoff.getState().set({
          gatewayId,
          conversationId,
          text: payload.text ?? '',
          attachments: payload.attachments,
          contextRefs: payload.contextRefs,
          autoSend: payload.autoSend,
          voiceCallMode: payload.voiceCallMode,
        });
      }
      if (!openRootChat(router, conversationId)) throw new Error(copy.quickChatOpenFailed);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.quickChatOpenFailed);
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [copy.quickChatOpenFailed, gatewayId, router, submitting]);

  const handleSend = useCallback((
    text: string,
    attachments?: WireAttachment[],
    refs?: ComposerContextRef[],
  ) => createAndOpen({ text, attachments, contextRefs: refs, autoSend: true }), [createAndOpen]);

  return (
    <KeyboardStickyView offset={{ closed: 0, opened: 0 }} style={styles.sticky}>
      <View
        testID="secondary-chat-bottom-region"
        style={[
          styles.surface,
          elevation.raised,
          { backgroundColor: colors.surface.elevated, borderColor: colors.border.subtle },
        ]}
      >
        {showsComposer ? <ChatComposer
          embedded
          conversationId={composerScope}
          actionsOpen={actionsOpen}
          onActionsOpenChange={setActionsOpen}
          disabled={!configured || submitting}
          streaming={false}
          onSend={handleSend}
          onAbort={() => undefined}
          placeholder={placeholderForRoute(route, copy)}
          contextRefs={contextRefs}
          onContextRefsChange={setContextRefs}
          onNewChat={() => { void createAndOpen(); }}
          onVoiceCallStart={(mode) => { void createAndOpen({ voiceCallMode: mode }); }}
        /> : null}
        <CapsuleTabBar {...props} embedded />
      </View>
      <AppToast visible={Boolean(error)} onDismiss={() => setError('')} bottomLift={96}>{error}</AppToast>
    </KeyboardStickyView>
  );
}

const styles = StyleSheet.create({
  sticky: { backgroundColor: 'transparent' },
  surface: {
    marginHorizontal: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderRadius: radii.xxl,
    overflow: 'hidden',
  },
});

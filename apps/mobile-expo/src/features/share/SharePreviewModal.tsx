import { useState } from 'react';
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { useMessages } from '../../i18n/messages';
import { radii, spacing, typography } from '../../theme';
import { useTheme } from '../../theme/useTheme';
import { FilePreviewHeader } from '../file-preview/FilePreviewHeader';

export type SharePreviewModalProps = {
  visible: boolean;
  url: string | null;
  title?: string | null;
  onClose: () => void;
};

export function SharePreviewModal({ visible, url, title, onClose }: SharePreviewModalProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const m = useMessages();
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  const headerTitle = title?.trim() || m.share.previewTitle;
  // Stable key per (url, visible) so opening a different share resets state.
  const stateKey = `${url ?? ''}|${visible ? '1' : '0'}`;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.surface.base, paddingTop: insets.top }]}>
        <FilePreviewHeader
          title={headerTitle}
          onClose={onClose}
          closeLabel={m.chat.filePreviewClose}
          shareLabel={m.chat.shareFilePreview}
          moreActionsLabel={m.chat.filePreviewMoreActions}
          share={url ? {
            onPress: async () => {
              await Share.share({ message: `${headerTitle}\n${url}`, url, title: headerTitle });
            },
          } : undefined}
          moreActions={[{
            key: 'open-browser',
            label: m.share.previewOpenExternal,
            icon: 'open-in-new',
            onPress: () => url ? Linking.openURL(url) : Promise.resolve(),
            disabled: !url,
          }]}
        />

        {url ? (
          <View style={styles.body}>
            <WebView
              key={stateKey}
              source={{ uri: url }}
              style={styles.webview}
              onLoadStart={() => {
                setLoading(true);
                setErrored(false);
              }}
              onLoadEnd={() => setLoading(false)}
              onError={() => setErrored(true)}
              // Block opening NEW windows from inside the preview — that
              // belongs in the system browser.
              setSupportMultipleWindows={false}
              originWhitelist={['*']}
              // Light hardening: posted JS messages are ignored (we don't
              // injectedJavaScript anything, but make the contract explicit).
              onMessage={onIgnoredMessage}
              // Some servers (esp. SPAs) need this on iOS.
              allowsBackForwardNavigationGestures={Platform.OS === 'ios'}
            />
            {loading ? (
              <View style={[styles.loaderOverlay, { backgroundColor: colors.surface.panel }]} pointerEvents="none">
                <ActivityIndicator />
                <Text style={[styles.loaderText, { color: colors.text.secondary }]}>
                  {m.share.previewLoading}
                </Text>
              </View>
            ) : null}
            {errored ? (
              <View style={[styles.errorOverlay, { backgroundColor: colors.surface.panel }]}>
                <Text style={[styles.errorText, { color: colors.semantic.errorBold }]}>
                  {m.share.previewError}
                </Text>
                <Pressable
                  onPress={() => void Linking.openURL(url)}
                  style={({ pressed }) => [
                    styles.errorButton,
                    { borderColor: colors.border.default, backgroundColor: colors.surface.input },
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={m.share.previewOpenExternal}
                >
                  <Text style={[styles.errorButtonText, { color: colors.text.primary }]}>
                    {m.share.previewOpenExternal}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function onIgnoredMessage(_event: WebViewMessageEvent): void {
  /* no-op — we don't process messages from share landing pages */
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  body: {
    flex: 1,
    position: 'relative',
  },
  webview: {
    flex: 1,
  },
  loaderOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loaderText: {
    ...typography.label,
    marginTop: spacing.sm,
  },
  errorOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.lg,
  },
  errorText: {
    ...typography.ui,
    textAlign: 'center',
  },
  errorButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  errorButtonText: {
    ...typography.ui,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.75,
  },
});

import { useCallback, useMemo, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { WebView, type WebViewNavigation } from 'react-native-webview';

import { t, useMessages } from '../../i18n/messages';
import { useGatewayStore } from '../../stores/gateway-store';
import { resolveEffectiveGatewayBaseUrl } from '../../stores/gateway-types';
import { radii, spacing, typography, useTheme } from '../../theme';
import {
  buildHtmlWebViewSource,
  shouldAllowHtmlWebViewNavigation,
  type HtmlWebViewSource,
} from './html-preview-source';

export type HtmlPreviewPaneProps = {
  workspaceRelativePath?: string;
  htmlContent?: string | null;
  sessionKey?: string | null;
  agentId?: string | null;
  mutedColor: string;
};

function previewUriFromSource(source: HtmlWebViewSource | null): string | undefined {
  return source && 'uri' in source ? source.uri : undefined;
}

export function HtmlPreviewPane({
  workspaceRelativePath,
  htmlContent,
  sessionKey,
  agentId,
  mutedColor,
}: HtmlPreviewPaneProps) {
  const { colors, isDark } = useTheme();
  const m = useMessages();
  const cm = m.chat;
  const apiUrl = useGatewayStore((s) => s.apiUrl);
  const token = useGatewayStore((s) => s.token);
  const gatewayBaseUrl = useGatewayStore((s) =>
    resolveEffectiveGatewayBaseUrl({
      activeBaseUrl: s.activeBaseUrl,
      baseUrl: s.baseUrl,
      lanUrl: s.lanUrl,
    }),
  );
  const [loading, setLoading] = useState(true);
  const [webError, setWebError] = useState<string | null>(null);

  const source = useMemo(
    () =>
      buildHtmlWebViewSource({
        workspaceRelativePath,
        htmlContent,
        sessionKey,
        agentId,
        apiUrl,
        token,
        gatewayBaseUrl,
      }),
    [agentId, apiUrl, gatewayBaseUrl, htmlContent, sessionKey, token, workspaceRelativePath],
  );

  const previewUri = previewUriFromSource(source);

  const handleNavigation = useCallback(
    (request: Pick<WebViewNavigation, 'url'>) => {
      const { url } = request;
      if (shouldAllowHtmlWebViewNavigation(url, previewUri, gatewayBaseUrl)) {
        return true;
      }
      void Linking.openURL(url).catch(() => undefined);
      return false;
    },
    [gatewayBaseUrl, previewUri],
  );

  if (!source) {
    return (
      <View style={styles.center}>
        <Text style={[styles.message, { color: mutedColor }]}>{cm.htmlPreviewUnavailable}</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <WebView
        source={source}
        style={styles.webview}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mixedContentMode="always"
        setSupportMultipleWindows={false}
        onLoadStart={() => {
          setLoading(true);
          setWebError(null);
        }}
        onLoadEnd={() => setLoading(false)}
        onError={(event) => {
          setLoading(false);
          setWebError(event.nativeEvent.description || cm.htmlPreviewWebViewFailed);
        }}
        onHttpError={(event) => {
          if (event.nativeEvent.statusCode >= 400) {
            setLoading(false);
            setWebError(`HTTP ${event.nativeEvent.statusCode}`);
          }
        }}
        onShouldStartLoadWithRequest={handleNavigation}
      />
      {loading ? (
        <View
          style={[
            styles.loadingOverlay,
            { backgroundColor: isDark ? colors.surface.panel : colors.surface.base },
          ]}
          pointerEvents="none"
        >
          <ActivityIndicator />
          <Text style={[styles.message, { color: mutedColor }]}>{cm.htmlPreviewRendering}</Text>
        </View>
      ) : null}
      {webError ? (
        <View style={[styles.errorBanner, { backgroundColor: colors.surface.input }]}>
          <Text style={[styles.errorText, { color: colors.semantic.errorBold }]}>
            {t(cm.htmlPreviewRenderFailed, { message: webError })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    opacity: 0.92,
  },
  errorBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  message: {
    ...typography.label,
  },
  errorText: {
    ...typography.label,
  },
});

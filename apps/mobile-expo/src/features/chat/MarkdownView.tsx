/**
 * Markdown renderer for chat messages.
 *
 * - **Native dev / release:** `react-native-enriched-markdown` (GFM, streaming on native).
 * - **Expo Go / Web / unsafe native tables / render errors:** `react-native-markdown-display` JS fallback.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import type { ComponentType } from 'react';
import { memo, useCallback, useMemo } from 'react';
import { Linking, Platform, StyleSheet } from 'react-native';
import Markdown from 'react-native-markdown-display';

import { ChatRenderErrorBoundary } from './ChatRenderErrorBoundary';
import { shouldUseMarkdownFallback } from './markdown-render-safety';
import { typography, useTheme, type ColorScheme } from '../../theme';

function createMarkdownStyle(themeColors: ColorScheme, isDark: boolean) {
  const codeBackground = isDark ? themeColors.surface.active : themeColors.surface.input;
  return {
    paragraph: {
      ...typography.body,
      color: themeColors.text.primary,
      marginBottom: 8,
    },
    h1: {
      ...typography.title,
      color: themeColors.text.primary,
      marginTop: 16,
      marginBottom: 8,
    },
    h2: {
      ...typography.heading,
      color: themeColors.text.primary,
      marginTop: 14,
      marginBottom: 6,
    },
    h3: {
      ...typography.heading,
      color: themeColors.text.primary,
      marginTop: 12,
      marginBottom: 4,
    },
    link: {
      color: themeColors.accent.primary,
      underline: false,
    },
    strong: {
      fontWeight: '600' as const,
    },
    code: {
      color: themeColors.accent.primary,
      backgroundColor: codeBackground,
    },
    codeBlock: {
      backgroundColor: codeBackground,
      color: themeColors.text.primary,
      ...typography.label,
      padding: 12,
      borderRadius: 8,
      marginBottom: 8,
    },
    blockquote: {
      backgroundColor: themeColors.surface.input,
      borderColor: themeColors.border.default,
      borderWidth: 3,
      color: themeColors.text.secondary,
    },
    list: {
      ...typography.body,
      color: themeColors.text.primary,
      marginLeft: 16,
      bulletColor: themeColors.text.secondary,
      markerColor: themeColors.text.secondary,
    },
    table: {
      ...typography.ui,
      color: themeColors.text.primary,
      borderColor: themeColors.border.default,
      borderWidth: 0,
      borderRadius: 6,
      headerBackgroundColor: themeColors.surface.input,
      rowEvenBackgroundColor: isDark ? themeColors.surface.panel : undefined,
      rowOddBackgroundColor: isDark ? themeColors.surface.input : undefined,
      cellPaddingHorizontal: 8,
      cellPaddingVertical: 8,
    },
    image: {
      borderRadius: 8,
      marginBottom: 4,
    },
  };
}

type MarkdownStyle = ReturnType<typeof createMarkdownStyle>;

function createJsMarkdownStyles(themeColors: ColorScheme, isDark: boolean) {
  const codeColor = themeColors.accent.primary;
  const codeBackground = isDark ? themeColors.surface.active : themeColors.surface.input;

  return StyleSheet.create({
    body: {
      ...typography.body,
      color: themeColors.text.primary,
    },
    paragraph: {
      ...typography.body,
      color: themeColors.text.primary,
      marginTop: 0,
      marginBottom: 8,
    },
    heading1: {
      ...typography.title,
      color: themeColors.text.primary,
      marginTop: 16,
      marginBottom: 8,
    },
    heading2: {
      ...typography.heading,
      color: themeColors.text.primary,
      marginTop: 14,
      marginBottom: 6,
    },
    heading3: {
      ...typography.heading,
      color: themeColors.text.primary,
      marginTop: 12,
      marginBottom: 4,
    },
    strong: {
      fontWeight: '600',
    },
    link: {
      color: themeColors.accent.primary,
      textDecorationLine: 'underline',
    },
    code_inline: {
      ...typography.label,
      color: codeColor,
      backgroundColor: codeBackground,
      borderWidth: 0,
      paddingHorizontal: 4,
      paddingVertical: 1,
    },
    fence: {
      ...typography.label,
      color: themeColors.text.primary,
      backgroundColor: codeBackground,
      borderWidth: 0,
      padding: 12,
      borderRadius: 8,
      marginBottom: 8,
    },
    code_block: {
      ...typography.label,
      color: themeColors.text.primary,
      backgroundColor: codeBackground,
      borderWidth: 0,
      padding: 12,
      borderRadius: 8,
      marginBottom: 8,
    },
    blockquote: {
      backgroundColor: themeColors.surface.input,
      borderColor: themeColors.border.default,
      borderLeftWidth: 3,
      paddingHorizontal: 12,
      paddingVertical: 4,
      marginBottom: 8,
    },
    bullet_list: {
      marginBottom: 8,
    },
    ordered_list: {
      marginBottom: 8,
    },
    list_item: {
      ...typography.body,
      color: themeColors.text.primary,
    },
    bullet_list_icon: {
      color: themeColors.text.secondary,
    },
    ordered_list_icon: {
      color: themeColors.text.secondary,
    },
    table: {
      borderWidth: 0,
      borderRadius: 6,
      marginBottom: 8,
    },
    thead: {
      backgroundColor: themeColors.surface.input,
    },
    tr: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: themeColors.border.default,
      flexDirection: 'row',
    },
    th: {
      flex: 1,
      paddingHorizontal: 8,
      paddingVertical: 8,
    },
    td: {
      flex: 1,
      paddingHorizontal: 8,
      paddingVertical: 8,
    },
  });
}

type JsMarkdownStyle = ReturnType<typeof createJsMarkdownStyles>;

type EnrichedProps = {
  markdown: string;
  flavor: 'github';
  markdownStyle: MarkdownStyle;
  streamingAnimation?: boolean;
  onLinkPress: (e: { url: string }) => void;
  selectable: boolean;
  allowTrailingMargin?: boolean;
};

/** Skip native streaming animation for large payloads — reduces native crash risk. */
const STREAMING_ANIMATION_MAX_CHARS = 8192;

function isExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

function getEnrichedMarkdownText(): ComponentType<EnrichedProps> | null {
  // Expo Go has no Fabric view manager; web should avoid the package's WASM entry.
  if (isExpoGo() || Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Expo Go must not load native module
    const mod = require('react-native-enriched-markdown') as {
      EnrichedMarkdownText: ComponentType<EnrichedProps>;
    };
    return mod.EnrichedMarkdownText;
  } catch {
    return null;
  }
}

function shouldUsePlainFallback(content: string, hasEnriched: boolean): boolean {
  return shouldUseMarkdownFallback({ content, hasEnriched, platform: Platform.OS });
}

/** JS markdown renderer for Expo Go, unsafe native tables, and native render errors. */
const JsMarkdownFallback = memo(function JsMarkdownFallback({
  content,
  themeColors,
  isDark,
  onLinkPress,
}: {
  content: string;
  themeColors: ColorScheme;
  isDark: boolean;
  onLinkPress?: (url: string) => void;
}) {
  const style = useMemo(
    () => createJsMarkdownStyles(themeColors, isDark),
    [themeColors, isDark],
  );

  const handleLinkPress = useCallback((url: string) => {
    if (onLinkPress) {
      onLinkPress(url);
      return false;
    }
    void Linking.openURL(url);
    return false;
  }, [onLinkPress]);

  return (
    <Markdown style={style as JsMarkdownStyle} onLinkPress={handleLinkPress} mergeStyle>
      {content}
    </Markdown>
  );
});

const EnrichedMarkdownBody = memo(function EnrichedMarkdownBody({
  content,
  streaming,
  allowTrailingMargin,
  Enriched,
  markdownStyle,
  themeColors,
  isDark,
  onLinkPress,
}: {
  content: string;
  streaming: boolean;
  allowTrailingMargin: boolean;
  Enriched: ComponentType<EnrichedProps>;
  markdownStyle: MarkdownStyle;
  themeColors: ColorScheme;
  isDark: boolean;
  onLinkPress: (e: { url: string }) => void;
}) {
  const useStreamingAnimation =
    streaming && content.length <= STREAMING_ANIMATION_MAX_CHARS;

  return (
    <ChatRenderErrorBoundary
      fallback={
        <JsMarkdownFallback content={content} themeColors={themeColors} isDark={isDark} onLinkPress={(url) => onLinkPress({ url })} />
      }
    >
      <Enriched
        markdown={content}
        flavor="github"
        markdownStyle={markdownStyle as EnrichedProps['markdownStyle']}
        {...(useStreamingAnimation ? { streamingAnimation: true } : {})}
        onLinkPress={onLinkPress}
        selectable
        allowTrailingMargin={allowTrailingMargin}
      />
    </ChatRenderErrorBoundary>
  );
});

export const MarkdownView = memo(function MarkdownView({
  content,
  streaming = false,
  allowTrailingMargin = false,
  onLinkPress,
}: {
  content: string;
  /** When true, enables the streaming fade-in animation for new tokens (native renderer only). */
  streaming?: boolean;
  /**
   * When true, keeps marginBottom on the last markdown block in Yoga layout.
   * Use when another view (e.g. deliverables) sits directly below the markdown.
   */
  allowTrailingMargin?: boolean;
  onLinkPress?: (url: string) => void;
}) {
  const { colors, isDark } = useTheme();
  const Enriched = useMemo(() => getEnrichedMarkdownText(), []);
  const markdownStyle = useMemo(() => createMarkdownStyle(colors, isDark), [colors, isDark]);

  const handleLinkPress = useCallback(({ url }: { url: string }) => {
    if (onLinkPress) {
      onLinkPress(url);
      return;
    }
    void Linking.openURL(url);
  }, [onLinkPress]);

  if (!content?.trim()) return null;

  if (shouldUsePlainFallback(content, Enriched != null)) {
    return <JsMarkdownFallback content={content} themeColors={colors} isDark={isDark} onLinkPress={onLinkPress} />;
  }

  return (
    <EnrichedMarkdownBody
      content={content}
      streaming={streaming}
      allowTrailingMargin={allowTrailingMargin}
      Enriched={Enriched!}
      markdownStyle={markdownStyle}
      themeColors={colors}
      isDark={isDark}
      onLinkPress={handleLinkPress}
    />
  );
});

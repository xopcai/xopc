/**
 * Markdown renderer for chat messages using react-native-enriched-markdown.
 *
 * Uses native Fabric text rendering (no WebView) with:
 * - GFM tables support (flavor="github")
 * - Streaming fade-in animation for LLM responses
 * - Dark/light mode via markdownStyle
 * - Interactive link handling
 */
import { memo, useCallback, useMemo } from 'react';
import { Linking, useColorScheme } from 'react-native';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import type { MarkdownStyle } from 'react-native-enriched-markdown';

const lightStyle: MarkdownStyle = {
  paragraph: {
    fontSize: 15,
    lineHeight: 22,
    color: '#1F2937',
    marginBottom: 8,
  },
  h1: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#111827',
    marginTop: 16,
    marginBottom: 8,
  },
  h2: {
    fontSize: 19,
    fontWeight: '600',
    color: '#111827',
    marginTop: 14,
    marginBottom: 6,
  },
  h3: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1F2937',
    marginTop: 12,
    marginBottom: 4,
  },
  link: {
    color: '#2563EB',
    underline: false,
  },
  strong: {
    fontWeight: 'bold',
  },
  code: {
    color: '#DB2777',
    backgroundColor: '#F3F4F6',
  },
  codeBlock: {
    backgroundColor: '#F3F4F6',
    color: '#374151',
    fontSize: 13,
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  blockquote: {
    backgroundColor: '#F9FAFB',
    borderColor: '#D1D5DB',
    borderWidth: 3,
  },
  list: {
    fontSize: 15,
    marginLeft: 16,
    bulletColor: '#6B7280',
    markerColor: '#6B7280',
  },
  table: {
    fontSize: 14,
    borderColor: '#E5E7EB',
    borderRadius: 6,
    headerBackgroundColor: '#F9FAFB',
    cellPaddingHorizontal: 8,
    cellPaddingVertical: 8,
  },
  image: {
    borderRadius: 8,
    marginBottom: 4,
  },
};

const darkStyle: MarkdownStyle = {
  paragraph: {
    fontSize: 15,
    lineHeight: 22,
    color: '#E5E7EB',
    marginBottom: 8,
  },
  h1: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#F9FAFB',
    marginTop: 16,
    marginBottom: 8,
  },
  h2: {
    fontSize: 19,
    fontWeight: '600',
    color: '#F9FAFB',
    marginTop: 14,
    marginBottom: 6,
  },
  h3: {
    fontSize: 17,
    fontWeight: '600',
    color: '#F3F4F6',
    marginTop: 12,
    marginBottom: 4,
  },
  link: {
    color: '#60A5FA',
    underline: false,
  },
  strong: {
    fontWeight: 'bold',
  },
  code: {
    color: '#F9A8D4',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  codeBlock: {
    backgroundColor: '#1E1E1E',
    color: '#D4D4D4',
    fontSize: 13,
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  blockquote: {
    backgroundColor: '#1F2937',
    borderColor: '#4B5563',
    borderWidth: 3,
    color: '#D1D5DB',
  },
  list: {
    fontSize: 15,
    color: '#E5E7EB',
    marginLeft: 16,
    bulletColor: '#9CA3AF',
    markerColor: '#9CA3AF',
  },
  table: {
    fontSize: 14,
    color: '#E5E7EB',
    borderColor: '#374151',
    borderRadius: 6,
    headerBackgroundColor: '#1F2937',
    rowEvenBackgroundColor: '#111827',
    rowOddBackgroundColor: '#1A1A2E',
    cellPaddingHorizontal: 8,
    cellPaddingVertical: 8,
  },
  image: {
    borderRadius: 8,
    marginBottom: 4,
  },
};

export const MarkdownView = memo(function MarkdownView({
  content,
  streaming = false,
}: {
  content: string;
  /** When true, enables the streaming fade-in animation for new tokens. */
  streaming?: boolean;
}) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';

  const markdownStyle = useMemo(
    () => (isDark ? darkStyle : lightStyle),
    [isDark],
  );

  const handleLinkPress = useCallback(({ url }: { url: string }) => {
    void Linking.openURL(url);
  }, []);

  if (!content?.trim()) return null;

  return (
    <EnrichedMarkdownText
      markdown={content}
      flavor="github"
      markdownStyle={markdownStyle}
      streamingAnimation={streaming}
      onLinkPress={handleLinkPress}
      selectable
    />
  );
});

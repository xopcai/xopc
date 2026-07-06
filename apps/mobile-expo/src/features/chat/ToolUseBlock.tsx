/**
 * Tool execution indicator for assistant messages.
 *
 * Two modes:
 * - **standalone** (default): wrapped in its own card with left border accent.
 * - **inline** (`inline={true}`): compact row inside an AssistantStepsBlock timeline.
 */
import { memo, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Icon, Text } from 'react-native-paper';

import { TOOL_NAMES_WITH_WORKSPACE_OUTPUT } from './assistant-message-artifacts';
import type { ToolUseContent } from './messages.types';
import { chatColors } from './styles';
import { useTheme } from '../../theme';
import { getFriendlyToolTitle } from './tool-friendly-title';
import { formatParamsJson, getKeyDetailLine } from './tool-input-preview';
import { extractFilePathsFromToolResult } from './tool-result-file-paths';
import { WebSearchToolResultLinks } from './WebSearchToolResultLinks';
import {
  extractWebSearchLinksFromToolResult,
  isWebSearchToolName,
} from './web-search-tool-result-links';
import { WorkspaceArtifactStrip } from './WorkspaceArtifactStrip';

export type ToolUseBlockLabels = {
  searchedWeb: string;
  readFile: string;
  runCommand: string;
  listDirectory: string;
  writeFile: string;
  editFile: string;
  openUrl: string;
  fetchUrl: string;
  unknownTool: string;
  stepDetails: string;
  toolInput: string;
  toolOutput: string;
  noOutput: string;
  toolRunning: string;
  toolError: string;
  searchResults: string;
  showMoreResults: string;
  showLessResults: string;
};

function statusColor(
  status: ToolUseContent['status'],
  colors: ReturnType<typeof useTheme>['colors'],
) {
  switch (status) {
    case 'running':
      return colors.accent.primary;
    case 'done':
      return colors.semantic.success;
    case 'error':
      return colors.semantic.error;
  }
}

function formatToolResultText(result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'string') return result.trim();
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

export const ToolUseBlock = memo(function ToolUseBlock({
  block,
  inline,
  sessionKey,
  labels,
  showWorkspaceArtifacts = true,
}: {
  block: ToolUseContent;
  /** When true, renders as a compact row inside AssistantStepsBlock. */
  inline?: boolean;
  sessionKey?: string | null;
  labels?: ToolUseBlockLabels;
  showWorkspaceArtifacts?: boolean;
}) {
  const { colors, isDark } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const color = statusColor(block.status, colors);
  const muted = colors.text.secondary;
  const subtle = colors.text.tertiary;
  const bodyColor = colors.text.primary;
  const isRunning = block.status === 'running';
  const isError = block.status === 'error';

  const friendlyLabels = labels ?? {
    searchedWeb: 'Searched web',
    readFile: 'Read file',
    runCommand: 'Run command',
    listDirectory: 'Browse folder',
    writeFile: 'Save file',
    editFile: 'Edit file',
    openUrl: 'Open link',
    fetchUrl: 'Fetch webpage',
    unknownTool: 'Running {{name}}',
    stepDetails: 'Details',
    toolInput: 'Input',
    toolOutput: 'Output',
    noOutput: '(no output)',
    toolRunning: 'Running…',
    toolError: 'Error',
    searchResults: '{{count}} results',
    showMoreResults: 'Show more',
    showLessResults: 'Show less',
  };

  const title = getFriendlyToolTitle(block.name, friendlyLabels);
  const detailLine = getKeyDetailLine(block.input);

  const resultText = useMemo(() => formatToolResultText(block.result), [block.result]);
  const resultPreview = resultText.length > 200 ? resultText.slice(0, 200) + '…' : resultText;

  let outputPreview = resultText;
  if (outputPreview) {
    try {
      outputPreview = JSON.stringify(JSON.parse(outputPreview), null, 2);
    } catch {
      /* keep */
    }
  }

  const paramsJson = block.input !== undefined ? formatParamsJson(block.input) : '';

  const extractedFilePaths = useMemo(() => {
    if (block.status === 'running' || block.status === 'error') {
      return [];
    }
    if (!TOOL_NAMES_WITH_WORKSPACE_OUTPUT.has(block.name)) {
      return [];
    }
    if (!resultText.trim()) {
      return [];
    }
    return extractFilePathsFromToolResult(resultText);
  }, [block.name, block.status, resultText]);

  const webSearchLinks = useMemo(() => {
    if (block.status === 'running' || block.status === 'error') {
      return [];
    }
    if (!isWebSearchToolName(block.name) || !resultText) {
      return [];
    }
    return extractWebSearchLinksFromToolResult(resultText);
  }, [block.name, block.status, resultText]);

  const fileLinks =
    showWorkspaceArtifacts && extractedFilePaths.length > 0 ? (
      <View style={styles.fileLinks}>
        <WorkspaceArtifactStrip paths={extractedFilePaths} sessionKey={sessionKey} />
      </View>
    ) : null;

  // ── Inline mode: compact row for AssistantStepsBlock timeline ──
  if (inline) {
    return (
      <View style={inlineStyles.row}>
        <View style={inlineStyles.iconCol}>
          {isRunning ? (
            <ActivityIndicator size={12} color={muted} />
          ) : isError ? (
            <Icon source="close-circle-outline" size={14} color={colors.semantic.error} />
          ) : (
            <Icon source="check-circle-outline" size={14} color={colors.semantic.success} />
          )}
        </View>
        <View style={inlineStyles.content}>
          <View style={inlineStyles.titleRow}>
            <Text
              variant="labelSmall"
              style={[inlineStyles.label, { color: bodyColor }]}
              numberOfLines={2}
            >
              {title}
            </Text>
            {isRunning ? (
              <Text variant="labelSmall" style={inlineStyles.statusMuted}>
                {friendlyLabels.toolRunning}
              </Text>
            ) : isError ? (
              <Text variant="labelSmall" style={{ fontSize: 10, color: colors.semantic.error }}>
                {friendlyLabels.toolError}
              </Text>
            ) : null}
          </View>
          {detailLine ? (
            <Text
              variant="bodySmall"
              numberOfLines={2}
              style={[inlineStyles.detailText, { color: muted }]}
            >
              {detailLine}
            </Text>
          ) : null}
          {isError && resultText ? (
            <Text
              variant="bodySmall"
              numberOfLines={2}
              style={[inlineStyles.errorText, { color: colors.semantic.error }]}
            >
              {resultText}
            </Text>
          ) : null}
          {!isRunning ? (
            <Pressable
              style={inlineStyles.detailsToggle}
              onPress={() => setDetailsExpanded((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: detailsExpanded }}
              accessibilityLabel={friendlyLabels.stepDetails}
            >
              <Icon
                source={detailsExpanded ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={subtle}
              />
              <Text variant="labelSmall" style={inlineStyles.detailsLabel}>
                {friendlyLabels.stepDetails}
              </Text>
            </Pressable>
          ) : null}
          {detailsExpanded && !isRunning ? (
            <ScrollView
              style={[inlineStyles.detailsScroll, { backgroundColor: colors.surface.input }]}
              nestedScrollEnabled
            >
              {paramsJson ? (
                <View style={inlineStyles.detailsSection}>
                  <Text variant="labelSmall" style={inlineStyles.detailsHeading}>
                    {friendlyLabels.toolInput}
                  </Text>
                  <Text
                    variant="bodySmall"
                    style={[inlineStyles.mono, { color: muted }]}
                    selectable
                  >
                    {paramsJson}
                  </Text>
                </View>
              ) : null}
              <View style={inlineStyles.detailsSection}>
                <Text variant="labelSmall" style={inlineStyles.detailsHeading}>
                  {friendlyLabels.toolOutput}
                </Text>
                <Text
                  variant="bodySmall"
                  style={[inlineStyles.mono, { color: muted }]}
                  selectable
                >
                  {outputPreview || friendlyLabels.noOutput}
                </Text>
              </View>
            </ScrollView>
          ) : null}
          {!isRunning && !isError && webSearchLinks.length > 0 ? (
            <WebSearchToolResultLinks
              links={webSearchLinks}
              labels={{
                summary: friendlyLabels.searchResults,
                showMore: friendlyLabels.showMoreResults,
                showLess: friendlyLabels.showLessResults,
              }}
            />
          ) : null}
          {fileLinks}
        </View>
      </View>
    );
  }

  // ── Standalone mode: card with left border accent (original behaviour) ──
  const hasResult = block.result != null;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark ? chatColors.toolBgDark : chatColors.toolBg,
          borderLeftColor: color,
        },
      ]}
    >
      <Pressable
        style={styles.header}
        onPress={() => hasResult && setExpanded((v) => !v)}
        accessibilityRole={hasResult ? 'button' : 'text'}
        accessibilityLabel={`Tool: ${block.name}, status: ${block.status}`}
      >
        {isRunning ? (
          <ActivityIndicator size={12} color={color} />
        ) : isError ? (
          <Icon source="alert-circle-outline" size={14} color={color} />
        ) : (
          <Icon source="check-circle-outline" size={14} color={color} />
        )}
        <Text
          variant="labelSmall"
          style={[styles.name, { color: bodyColor }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {hasResult ? (
          <Icon
            source={expanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={subtle}
          />
        ) : null}
      </Pressable>
      {expanded && resultText ? (
        <View style={styles.resultContainer}>
          <Text
            variant="bodySmall"
            style={[
              styles.result,
              { color: muted },
            ]}
            selectable
          >
            {resultPreview}
          </Text>
          {fileLinks}
        </View>
      ) : null}
    </View>
  );
});

// ── Inline styles (for AssistantStepsBlock timeline) ──
const inlineStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    minWidth: 0,
  },
  iconCol: {
    paddingTop: 2,
  },
  content: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  titleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  labelPill: {
    maxWidth: '100%',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  label: {
    fontWeight: '500',
    fontSize: 12,
  },
  statusMuted: {
    fontSize: 10,
    color: chatColors.timestamp,
  },
  detailBox: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  detailText: {
    fontSize: 11,
    lineHeight: 16,
  },
  errorText: {
    fontSize: 11,
    lineHeight: 16,
  },
  detailsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    minHeight: 32,
  },
  detailsLabel: {
    fontSize: 11,
    color: chatColors.timestamp,
  },
  detailsScroll: {
    maxHeight: 192,
    borderRadius: 6,
    padding: 8,
  },
  detailsSection: {
    marginBottom: 8,
  },
  detailsHeading: {
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: chatColors.timestamp,
    marginBottom: 2,
  },
  mono: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: 'monospace',
  },
});

// ── Standalone styles (card with left border) ──
const styles = StyleSheet.create({
  container: {
    borderLeftWidth: 3,
    borderRadius: 6,
    marginVertical: 3,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  name: {
    flex: 1,
    fontWeight: '500',
    fontSize: 12,
  },
  resultContainer: {
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  result: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: 'monospace',
  },
  fileLinks: {
    marginTop: 8,
  },
});

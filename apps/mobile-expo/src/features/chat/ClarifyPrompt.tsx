import { memo, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import { useTheme } from '../../theme';
import { MarkdownView } from './MarkdownView';

export type ClarifyPromptState = {
  requestId: string;
  kind: 'input' | 'approval';
  question: string;
  choices?: string[];
  suggestedAnswer?: string;
  version: number;
  createdAt: number;
  expiresAt?: number;
};

type ClarifyPromptView = Pick<ClarifyPromptState, 'requestId' | 'question' | 'choices' | 'suggestedAnswer' | 'expiresAt'>
  & Partial<Pick<ClarifyPromptState, 'kind' | 'version' | 'createdAt'>>;

type ClarifyPromptProps = {
  prompt: ClarifyPromptView | null;
  submitting: boolean;
  submitError: string | null;
  onSubmit: (answer: string) => void;
  onAgentDecide: () => void;
  onCancel: () => void;
};

export const ClarifyPrompt = memo(function ClarifyPrompt({
  prompt,
  submitting,
  submitError,
  onSubmit,
  onAgentDecide,
  onCancel,
}: ClarifyPromptProps) {
  const { colors, elevation } = useTheme();
  const labels = useMessages().chat;
  const [draft, setDraft] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setDraft('');
  }, [prompt?.requestId]);

  useEffect(() => {
    if (!prompt?.expiresAt) return;
    const timer = setInterval(() => setTick(value => value + 1), 1_000);
    return () => clearInterval(timer);
  }, [prompt?.expiresAt]);

  const choices = useMemo(
    () => prompt?.choices?.filter((choice) => choice.trim().length > 0) ?? [],
    [prompt?.choices],
  );

  if (!prompt) return null;

  const trimmedDraft = draft.trim();
  const canSubmitDraft = trimmedDraft.length > 0 && !submitting;
  const borderColor = colors.border.default;
  const cardBg = colors.surface.panel;
  const mutedColor = colors.text.secondary;
  const textColor = colors.text.primary;
  const inputBg = colors.surface.input;
  const remainingSeconds = prompt.expiresAt
    ? Math.max(0, Math.ceil((prompt.expiresAt - Date.now()) / 1_000))
    : null;
  void tick;

  const submitDraft = () => {
    if (!canSubmitDraft) return;
    onSubmit(trimmedDraft);
  };

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor }, elevation.raised]}>
      <View style={styles.headerRow}>
        <View style={styles.headerIcon}>
          {submitting ? (
            <ActivityIndicator size={16} />
          ) : (
            <Icon source="help-circle-outline" size={18} color={colors.accent.primary} />
          )}
        </View>
        <View style={styles.headerTextCol}>
          <Text variant="labelLarge" style={[styles.title, { color: textColor }]}>
            {labels.clarifyTitle}
          </Text>
          <Text variant="bodySmall" style={{ color: mutedColor }}>
            {labels.clarifyHint}
          </Text>
        </View>
      </View>

      <View style={styles.question}>
        <MarkdownView content={prompt.question} />
      </View>

      {choices.length > 0 ? (
        <ScrollView
          style={styles.choicesScroll}
          contentContainerStyle={styles.choicesContent}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {choices.map((choice) => (
            <Pressable
              key={choice}
              disabled={submitting}
              style={({ pressed }) => [
                styles.choiceButton,
                {
                  borderColor,
                  backgroundColor: pressed
                    ? colors.accent.selectionBg
                    : inputBg,
                  opacity: submitting ? 0.6 : 1,
                },
              ]}
              onPress={() => onSubmit(choice)}
            >
              <Text style={[styles.choiceText, { color: textColor }]}>{choice}</Text>
            </Pressable>
          ))}
          {prompt.suggestedAnswer ? (
            <Pressable
              disabled={submitting}
              style={({ pressed }) => [
                styles.choiceButton,
                styles.suggestedChoiceButton,
                {
                  borderColor,
                  backgroundColor: pressed
                    ? colors.surface.hover
                    : 'transparent',
                  opacity: submitting ? 0.6 : 1,
                },
              ]}
              onPress={() => onSubmit(prompt.suggestedAnswer!)}
            >
              <Text style={[styles.choiceText, { color: mutedColor }]}>
                {labels.clarifyUseSuggested}: {prompt.suggestedAnswer}
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : null}

      <View style={styles.inputRow}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          editable={!submitting}
          placeholder={labels.clarifyPlaceholder}
          placeholderTextColor={colors.text.tertiary}
          style={[
            styles.input,
            {
              color: textColor,
              backgroundColor: inputBg,
              borderColor,
            },
          ]}
          returnKeyType="send"
          onSubmitEditing={submitDraft}
        />
        <Button
          mode="contained"
          compact
          disabled={!canSubmitDraft}
          onPress={submitDraft}
          style={styles.sendButton}
        >
          {labels.clarifySend}
        </Button>
      </View>

      {submitError ? (
        <Text variant="bodySmall" style={[styles.errorText, { color: colors.semantic.errorBold }]}>
          {submitError}
        </Text>
      ) : null}

      <View style={styles.footerRow}>
        <Text variant="bodySmall" style={{ color: mutedColor }}>
          {prompt.kind === 'approval'
            ? `${labels.clarifyApprovalTimeout}${remainingSeconds === null ? '' : ` ${labels.clarifyTimeRemaining.replace('{{time}}', `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, '0')}`)}`}`
            : labels.clarifyDurableNote}
        </Text>
        <View style={styles.footerActions}>
          {prompt.kind === 'input' ? (
            <Button mode="text" compact disabled={submitting} onPress={onAgentDecide}>
              {labels.clarifyAgentDecide}
            </Button>
          ) : null}
          <Button mode="text" compact disabled={submitting} onPress={onCancel}>
            {labels.clarifyCancel}
          </Button>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    marginHorizontal: 12,
    marginBottom: 10,
    padding: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIcon: {
    width: 24,
    alignItems: 'center',
  },
  headerTextCol: {
    flex: 1,
  },
  title: {
    fontWeight: '700',
  },
  question: {
    marginTop: 10,
  },
  choicesScroll: {
    maxHeight: 180,
    marginTop: 8,
  },
  choicesContent: {
    gap: 8,
    paddingBottom: 2,
  },
  choiceButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  suggestedChoiceButton: {
    borderStyle: 'dashed',
  },
  choiceText: {
    fontSize: 14,
    lineHeight: 20,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  input: {
    flex: 1,
    minHeight: 40,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  sendButton: {
    borderRadius: 12,
  },
  errorText: {
    marginTop: 8,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 8,
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});

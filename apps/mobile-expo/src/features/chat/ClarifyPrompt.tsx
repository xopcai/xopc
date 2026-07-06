import { memo, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text } from 'react-native-paper';

import { useMessages } from '../../i18n/messages';
import { useTheme } from '../../theme';
import { MarkdownView } from './MarkdownView';

export type ClarifyPromptState = {
  requestId: string;
  question: string;
  choices?: string[];
  default?: string;
};

type ClarifyPromptProps = {
  prompt: ClarifyPromptState | null;
  submitting: boolean;
  submitError: string | null;
  onSubmit: (answer: string) => void;
  onSkip: () => void;
};

export const ClarifyPrompt = memo(function ClarifyPrompt({
  prompt,
  submitting,
  submitError,
  onSubmit,
  onSkip,
}: ClarifyPromptProps) {
  const { colors } = useTheme();
  const labels = useMessages().chat;
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setDraft('');
  }, [prompt?.requestId]);

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

  const submitDraft = () => {
    if (!canSubmitDraft) return;
    onSubmit(trimmedDraft);
  };

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
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
          {prompt.default ? (
            <Pressable
              disabled={submitting}
              style={({ pressed }) => [
                styles.choiceButton,
                styles.defaultChoiceButton,
                {
                  borderColor,
                  backgroundColor: pressed
                    ? colors.surface.hover
                    : 'transparent',
                  opacity: submitting ? 0.6 : 1,
                },
              ]}
              onPress={() => onSubmit(prompt.default!)}
            >
              <Text style={[styles.choiceText, { color: mutedColor }]}>
                {labels.clarifyUseDefault}: {prompt.default}
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
          {labels.clarifyTimeoutNote}
        </Text>
        <Button mode="text" compact disabled={submitting} onPress={onSkip}>
          {labels.clarifySkip}
        </Button>
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
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
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
  defaultChoiceButton: {
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
});

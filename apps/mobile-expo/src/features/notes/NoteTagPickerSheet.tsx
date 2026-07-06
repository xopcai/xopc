import { memo, useCallback, useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { BottomSheetModal } from '../../components/BottomSheetModal';
import { useMessages } from '../../i18n/messages';
import { useTheme } from '../../theme';
import { getTagColors } from './note-tag-utils';

type NoteTagPickerSheetBaseProps = {
  visible: boolean;
  tags: readonly string[];
  onCreateTag: (tag: string) => string | null;
  onDismiss: () => void;
  focusCreate?: boolean;
};

type NoteTagPickerSheetSingleProps = NoteTagPickerSheetBaseProps & {
  mode?: 'single';
  selectedTag: string | null;
  onSelect: (tag: string | null) => void;
};

type NoteTagPickerSheetMultiProps = NoteTagPickerSheetBaseProps & {
  mode: 'multi';
  selectedTags: string[];
  onApplyTags: (tags: string[]) => void;
};

export type NoteTagPickerSheetProps = NoteTagPickerSheetSingleProps | NoteTagPickerSheetMultiProps;

export const NoteTagPickerSheet = memo(function NoteTagPickerSheet(props: NoteTagPickerSheetProps) {
  const {
    visible,
    tags,
    onCreateTag,
    onDismiss,
    focusCreate = false,
  } = props;
  const isMulti = props.mode === 'multi';
  const selectedTagsForMulti = isMulti ? props.selectedTags : [];
  const { colors } = useTheme();
  const pm = useMessages().notesPage;
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [draftTags, setDraftTags] = useState<string[]>([]);

  useEffect(() => {
    if (!visible) {
      setDraft('');
      setError('');
      return;
    }
    if (isMulti) {
      setDraftTags(selectedTagsForMulti);
    }
  }, [isMulti, selectedTagsForMulti, visible]);

  const handleSelectSingle = useCallback(
    (tag: string | null) => {
      if (props.mode === 'multi') return;
      props.onSelect(tag);
      onDismiss();
    },
    [onDismiss, props],
  );

  const toggleDraftTag = useCallback((tag: string) => {
    setDraftTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag],
    );
  }, []);

  const handleCreate = useCallback(() => {
    const created = onCreateTag(draft);
    if (!created) {
      setError(pm.tagInvalid);
      return;
    }
    setDraft('');
    setError('');
    if (isMulti) {
      setDraftTags((current) => (current.includes(created) ? current : [...current, created]));
      return;
    }
    handleSelectSingle(created);
  }, [draft, handleSelectSingle, isMulti, onCreateTag, pm.tagInvalid]);

  const handleApplyMulti = useCallback(() => {
    if (props.mode !== 'multi') return;
    props.onApplyTags(draftTags);
    onDismiss();
  }, [draftTags, onDismiss, props]);

  const selectedTag = props.mode === 'multi' ? null : props.selectedTag;

  return (
    <BottomSheetModal
      visible={visible}
      onDismiss={onDismiss}
      title={isMulti ? pm.tagPickerTitleMulti : pm.tagPickerTitle}
      subtitle={isMulti ? pm.tagMultiHint : undefined}
      headerAction={isMulti ? (
        <Pressable onPress={() => setDraftTags([])} hitSlop={8}>
          <Text style={[styles.clearAll, { color: colors.accent.primary }]}>{pm.tagClearAll}</Text>
        </Pressable>
      ) : null}
      maxHeight="72%"
      keyboardAvoiding
      scroll
      footer={
        <View style={styles.createBlock}>
          <Text style={[styles.createLabel, { color: colors.text.secondary }]}>{pm.tagCreateLabel}</Text>
          <View style={styles.createRow}>
            <TextInput
              value={draft}
              onChangeText={(value) => {
                setDraft(value);
                if (error) setError('');
              }}
              placeholder={pm.tagCreatePlaceholder}
              placeholderTextColor={colors.text.tertiary}
              style={[
                styles.input,
                {
                  color: colors.text.primary,
                  backgroundColor: colors.surface.input,
                  borderColor: error ? colors.semantic.error : colors.border.default,
                },
              ]}
              autoFocus={focusCreate}
              returnKeyType="done"
              onSubmitEditing={handleCreate}
              maxLength={24}
            />
            <Pressable
              style={[
                styles.createBtn,
                {
                  backgroundColor: draft.trim() ? colors.text.primary : colors.surface.input,
                },
              ]}
              onPress={handleCreate}
              disabled={!draft.trim()}
            >
              <Text
                style={{
                  color: draft.trim() ? colors.text.inverse : colors.text.tertiary,
                  fontWeight: '600',
                  fontSize: 14,
                }}
              >
                {pm.tagCreateAction}
              </Text>
            </Pressable>
          </View>
          {error ? (
            <Text style={[styles.errorText, { color: colors.semantic.error }]}>{error}</Text>
          ) : null}
          {isMulti ? (
            <Pressable
              style={[styles.doneBtn, { backgroundColor: colors.text.primary }]}
              onPress={handleApplyMulti}
            >
              <Text style={[styles.doneBtnText, { color: colors.text.inverse }]}>{pm.tagDone}</Text>
            </Pressable>
          ) : null}
        </View>
      }
    >
      {!isMulti ? (
        <Pressable
          style={({ pressed }) => [
            styles.row,
            !selectedTag && { backgroundColor: colors.accent.selectionBg },
            pressed && { backgroundColor: colors.surface.hover },
          ]}
          onPress={() => handleSelectSingle(null)}
        >
          <View style={[styles.chip, { backgroundColor: getTagColors(null, tags, colors).bg }]}>
            <Text style={[styles.chipText, { color: getTagColors(null, tags, colors).fg }]}>{pm.defaultTag}</Text>
          </View>
          <Text style={[styles.rowLabel, { color: colors.text.secondary }]}>{pm.tagUntaggedHint}</Text>
          {!selectedTag ? <Icon source="check" size={18} color={colors.accent.primary} /> : null}
        </Pressable>
      ) : null}

      {tags.map((tag) => {
        const palette = getTagColors(tag, tags, colors);
        const isActive = isMulti ? draftTags.includes(tag) : selectedTag === tag;
        return (
          <Pressable
            key={tag}
            style={({ pressed }) => [
              styles.row,
              isActive && { backgroundColor: colors.accent.selectionBg },
              pressed && { backgroundColor: colors.surface.hover },
            ]}
            onPress={() => (isMulti ? toggleDraftTag(tag) : handleSelectSingle(tag))}
          >
            <View style={[styles.chip, { backgroundColor: palette.bg }]}>
              <Text style={[styles.chipText, { color: palette.fg }]}>{tag}</Text>
            </View>
            {isActive ? <Icon source="check" size={18} color={colors.accent.primary} /> : null}
          </Pressable>
        );
      })}
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  clearAll: {
    fontSize: 13,
    fontWeight: '600',
    paddingTop: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 2,
  },
  rowLabel: {
    flex: 1,
    fontSize: 13,
  },
  chip: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  createBlock: {
    gap: 8,
  },
  createLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.select({ ios: 10, default: 8 }),
    fontSize: 15,
  },
  createBtn: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  doneBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  doneBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  errorText: {
    fontSize: 12,
  },
});

import { memo, useCallback, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import type { ChecklistMutationOp, WebchatChecklistItemWire, WebchatPersistentGoalWire } from '../../query/goals';
import { useTheme } from '../../theme';
import { groupedChecklistItems, itemMarker, type GoalMessages } from './goal-utils';

type Props = {
  goal: WebchatPersistentGoalWire;
  canEdit: boolean;
  mutationBusy: boolean;
  t: GoalMessages;
  onMutate: (m: ChecklistMutationOp) => void | Promise<void>;
};

type ChecklistItemWithIndex = WebchatChecklistItemWire & { index1Based: number };

export const GoalChecklistBoard = memo(function GoalChecklistBoard({ goal, canEdit, mutationBusy, t, onMutate }: Props) {
  const [open, setOpen] = useState(false);
  const [newCriterion, setNewCriterion] = useState('');
  const { colors } = useTheme();
  const items = goal.checklist ?? [];
  const groups = groupedChecklistItems(items);
  const inputBg = colors.surface.input;
  const border = colors.border.default;

  const submitAdd = useCallback(() => {
    const text = newCriterion.trim();
    if (!text || mutationBusy) return;
    void Promise.resolve(onMutate({ op: 'add', text })).then(() => setNewCriterion(''));
  }, [mutationBusy, newCriterion, onMutate]);

  const renderGroup = (title: string, rows: ChecklistItemWithIndex[]) => {
    if (rows.length === 0) return null;
    return (
      <View style={styles.group}>
        <View style={styles.groupHead}>
          <Text style={styles.groupTitle}>{title}</Text>
          <Text style={styles.groupCount}>{rows.length}</Text>
        </View>
        <View style={styles.itemList}>
          {rows.map((item) => (
            <View key={`${item.index1Based}-${item.text.slice(0, 18)}`} style={[styles.item, { borderColor: border }]}> 
              <View style={styles.itemMain}>
                <Text style={styles.marker}>{itemMarker(item)}</Text>
                <View style={styles.itemTextBox}>
                  <Text variant="bodySmall" style={styles.itemText}>{item.text}</Text>
                  <View style={styles.metaRow}>
                    <Text style={[styles.metaPill, { backgroundColor: colors.accent.selectionBg, color: colors.accent.primary }]}>
                      {item.addedBy === 'user' ? t.userAdded : t.judgeGenerated}
                    </Text>
                    {item.evidence ? <Text style={styles.evidence}>{t.evidenceLabel}: {item.evidence}</Text> : null}
                  </View>
                </View>
              </View>
              {canEdit && item.status === 'pending' ? (
                <View style={styles.actionRow}>
                  <Button compact mode="text" disabled={mutationBusy} onPress={() => void onMutate({ op: 'mark', index: item.index1Based, status: 'completed' })}>
                    {t.markDone}
                  </Button>
                  <Button compact mode="text" disabled={mutationBusy} onPress={() => void onMutate({ op: 'mark', index: item.index1Based, status: 'impossible' })}>
                    {t.markBlocked}
                  </Button>
                  <Button compact mode="text" textColor={colors.semantic.error} disabled={mutationBusy} onPress={() => void onMutate({ op: 'remove', index: item.index1Based })}>
                    {t.removeItem}
                  </Button>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.head} onPress={() => setOpen((v) => !v)}>
        <View>
          <Text variant="labelLarge" style={styles.heading}>{t.checklistHeading}</Text>
          <Text variant="bodySmall" style={styles.subtle}>
            {items.length > 0 ? t.checklistProgress.replace('{{done}}', String(groups.completed.length + groups.impossible.length)).replace('{{total}}', String(items.length)) : t.checklistEmpty}
          </Text>
        </View>
        <Text style={[styles.toggle, { color: colors.accent.primary }]}>{open ? t.collapse : t.expand}</Text>
      </Pressable>

      {open ? (
        <View style={styles.content}>
          {items.length > 0 ? (
            <>
              {renderGroup(t.pendingGroup, groups.pending)}
              {renderGroup(t.completedGroup, groups.completed)}
              {renderGroup(t.impossibleGroup, groups.impossible)}
            </>
          ) : (
            <Text variant="bodySmall" style={styles.subtle}>{t.checklistEmpty}</Text>
          )}

          {canEdit ? (
            <View style={styles.addRow}>
              <TextInput
                value={newCriterion}
                onChangeText={setNewCriterion}
                placeholder={t.addCriterionPlaceholder}
                placeholderTextColor={colors.text.tertiary}
                editable={!mutationBusy}
                style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: colors.text.primary }]}
                returnKeyType="done"
                onSubmitEditing={submitAdd}
              />
              <Button mode="contained-tonal" compact disabled={mutationBusy || !newCriterion.trim()} onPress={submitAdd}>
                {t.addCriterion}
              </Button>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    gap: 10,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  heading: {
    fontWeight: '800',
  },
  subtle: {
    opacity: 0.62,
    lineHeight: 18,
  },
  toggle: {
    fontSize: 12,
    fontWeight: '800',
  },
  content: {
    gap: 12,
  },
  group: {
    gap: 6,
  },
  groupHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  groupTitle: {
    fontSize: 11,
    fontWeight: '800',
    opacity: 0.58,
    textTransform: 'uppercase',
  },
  groupCount: {
    fontSize: 11,
    fontWeight: '800',
    opacity: 0.52,
  },
  itemList: {
    gap: 7,
  },
  item: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 9,
    gap: 7,
  },
  itemMain: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  marker: {
    width: 18,
    textAlign: 'center',
    fontWeight: '900',
    opacity: 0.62,
    paddingTop: 1,
  },
  itemTextBox: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  itemText: {
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  metaPill: {
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    fontSize: 10,
    fontWeight: '800',
    overflow: 'hidden',
  },
  evidence: {
    flexShrink: 1,
    fontSize: 10,
    opacity: 0.58,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 38,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 8,
    fontSize: 13,
  },
});

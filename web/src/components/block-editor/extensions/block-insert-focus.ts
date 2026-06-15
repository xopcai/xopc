import type { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';

/**
 * Move the selection from a block NodeSelection or gapcursor into the nearest
 * following textblock. If none exists, append an empty paragraph at doc end.
 */
export function setTextSelectionAfterBlock(tr: Transaction): boolean {
  const { selection, doc } = tr;
  const schema = doc.type.schema;
  let targetPos = selection.from;

  if (selection instanceof NodeSelection) {
    targetPos = selection.to;
  } else {
    const $pos = doc.resolve(targetPos);
    if ($pos.parent.isTextblock) {
      return true;
    }
    targetPos = Math.min(targetPos + 1, doc.content.size);
  }

  const $target = doc.resolve(Math.min(targetPos, doc.content.size));
  if ($target.parent.isTextblock) {
    tr.setSelection(TextSelection.near($target, 1));
    return true;
  }

  const paragraph = schema.nodes.paragraph;
  if (!paragraph) {
    return false;
  }

  const end = doc.content.size;
  tr.insert(end, paragraph.create());
  tr.setSelection(TextSelection.near(tr.doc.resolve(end + 1), 1));
  return true;
}

/** Chain helper: focus the editable paragraph after a block node insert. */
export function focusAfterBlockInsert(editor: Editor): void {
  editor.commands.command(({ tr, dispatch }) => {
    if (dispatch) {
      setTextSelectionAfterBlock(tr);
    }
    return true;
  });
}

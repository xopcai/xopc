import { Node, mergeAttributes, type Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

declare module '@tiptap/core' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface NodeConfig<Options, Storage> {
    tableRole?: string;
  }
}

function findParentTableContext(editor: Editor) {
  const { $from } = editor.state.selection;
  let cellDepth = -1;
  let rowDepth = -1;
  let tableDepth = -1;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (cellDepth === -1 && (name === 'tableCell' || name === 'tableHeader')) cellDepth = d;
    else if (rowDepth === -1 && name === 'tableRow') rowDepth = d;
    else if (tableDepth === -1 && name === 'table') {
      tableDepth = d;
      break;
    }
  }
  if (cellDepth === -1 || rowDepth === -1 || tableDepth === -1) return null;
  const tableNode = $from.node(tableDepth);
  const tableStart = $from.start(tableDepth);
  const tablePos = $from.before(tableDepth);
  const rowIndex = $from.index(tableDepth);
  const colIndex = $from.index(rowDepth);
  return { tableNode, tableStart, tablePos, rowIndex, colIndex, cellDepth, rowDepth, tableDepth };
}

function cellContentPos(editor: Editor, tableStart: number, targetRow: number, targetCol: number): number | null {
  const table = editor.state.doc.nodeAt(tableStart - 1);
  if (!table || table.type.name !== 'table') return null;
  if (targetRow < 0 || targetRow >= table.childCount) return null;
  let pos = tableStart;
  for (let r = 0; r < targetRow; r++) {
    pos += table.child(r).nodeSize;
  }
  const row = table.child(targetRow);
  if (targetCol < 0 || targetCol >= row.childCount) return null;
  pos += 1; // inside tableRow
  for (let c = 0; c < targetCol; c++) {
    pos += row.child(c).nodeSize;
  }
  const cell = row.child(targetCol);
  // inside cell -> inside paragraph -> end of paragraph
  return pos + cell.nodeSize - 2;
}

export function insertMarkdownTable(editor: Editor, rows = 3, cols = 3): boolean {
  const headerCells = Array.from({ length: cols }, (_, index) => ({
    type: 'tableHeader',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: `列 ${index + 1}` }] }],
  }));
  const bodyRows = Array.from({ length: Math.max(1, rows - 1) }, () => ({
    type: 'tableRow',
    content: Array.from({ length: cols }, () => ({
      type: 'tableCell',
      content: [{ type: 'paragraph' }],
    })),
  }));
  return editor
    .chain()
    .focus()
    .insertContent({
      type: 'table',
      content: [{ type: 'tableRow', content: headerCells }, ...bodyRows],
    })
    .run();
}

export function addTableRowAfter(editor: Editor): boolean {
  const ctx = findParentTableContext(editor);
  if (!ctx) return false;
  const { state, view } = editor;
  const { tableNode, tableStart, rowIndex } = ctx;
  const colCount = tableNode.child(0)?.childCount ?? 1;
  const rowType = state.schema.nodes.tableRow;
  const cellType = state.schema.nodes.tableCell;
  const paragraphType = state.schema.nodes.paragraph;
  if (!rowType || !cellType || !paragraphType) return false;

  let insertPos = tableStart;
  for (let r = 0; r <= rowIndex; r++) {
    insertPos += tableNode.child(r).nodeSize;
  }
  const cells = Array.from({ length: colCount }, () => cellType.create(null, paragraphType.create()));
  const newRow = rowType.create(null, cells);
  const tr = state.tr.insert(insertPos, newRow);
  tr.setSelection(TextSelection.create(tr.doc, insertPos + 3));
  view.dispatch(tr.scrollIntoView());
  return true;
}

export function addTableColumnAfter(editor: Editor): boolean {
  const ctx = findParentTableContext(editor);
  if (!ctx) return false;
  const { state, view } = editor;
  const { tableNode, tableStart, colIndex } = ctx;
  const headerType = state.schema.nodes.tableHeader;
  const cellType = state.schema.nodes.tableCell;
  const paragraphType = state.schema.nodes.paragraph;
  if (!headerType || !cellType || !paragraphType) return false;

  let tr = state.tr;
  let rowStart = tableStart;
  for (let r = 0; r < tableNode.childCount; r++) {
    const row = tableNode.child(r);
    let cellInsertOffset = rowStart + 1;
    const limit = Math.min(colIndex + 1, row.childCount);
    for (let c = 0; c < limit; c++) {
      cellInsertOffset += row.child(c).nodeSize;
    }
    const mappedPos = tr.mapping.map(cellInsertOffset);
    const nodeToInsert =
      r === 0
        ? headerType.create(null, paragraphType.create(null, state.schema.text(`列 ${row.childCount + 1}`)))
        : cellType.create(null, paragraphType.create());
    tr = tr.insert(mappedPos, nodeToInsert);
    rowStart += row.nodeSize;
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

export function deleteCurrentTableRow(editor: Editor): boolean {
  const ctx = findParentTableContext(editor);
  if (!ctx) return false;
  const { state, view } = editor;
  const { tableNode, tablePos, rowDepth, rowIndex } = ctx;
  // Never delete the GFM header row alone; if <=2 rows and deleting body row leaves only header, or deleting header, handle safely.
  if (rowIndex === 0) return false;
  if (tableNode.childCount <= 2) {
    const tr = state.tr.delete(tablePos, tablePos + tableNode.nodeSize);
    view.dispatch(tr.scrollIntoView());
    return true;
  }
  const rowStart = state.selection.$from.before(rowDepth);
  const rowNode = state.selection.$from.node(rowDepth);
  const tr = state.tr.delete(rowStart, rowStart + rowNode.nodeSize);
  view.dispatch(tr.scrollIntoView());
  return true;
}

export function deleteCurrentTableColumn(editor: Editor): boolean {
  const ctx = findParentTableContext(editor);
  if (!ctx) return false;
  const { state, view } = editor;
  const { tableNode, tableStart, tablePos, colIndex } = ctx;
  const colCount = tableNode.child(0)?.childCount ?? 0;
  if (colCount <= 1) {
    const tr = state.tr.delete(tablePos, tablePos + tableNode.nodeSize);
    view.dispatch(tr.scrollIntoView());
    return true;
  }
  let tr = state.tr;
  let rowStart = tableStart;
  for (let r = 0; r < tableNode.childCount; r++) {
    const row = tableNode.child(r);
    if (colIndex < row.childCount) {
      let cellStart = rowStart + 1;
      for (let c = 0; c < colIndex; c++) {
        cellStart += row.child(c).nodeSize;
      }
      const cellSize = row.child(colIndex).nodeSize;
      const mappedFrom = tr.mapping.map(cellStart);
      const mappedTo = tr.mapping.map(cellStart + cellSize);
      tr = tr.delete(mappedFrom, mappedTo);
    }
    rowStart += row.nodeSize;
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

export function deleteCurrentTable(editor: Editor): boolean {
  const ctx = findParentTableContext(editor);
  if (!ctx) return false;
  const { state, view } = editor;
  const tr = state.tr.delete(ctx.tablePos, ctx.tablePos + ctx.tableNode.nodeSize);
  view.dispatch(tr.scrollIntoView());
  return true;
}

export const TableNode = Node.create({
  name: 'table',
  group: 'block',
  content: 'tableRow+',
  tableRole: 'table',
  isolating: true,

  parseHTML() {
    return [{ tag: 'table' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { class: 'block-editor-table-wrap' }, ['table', mergeAttributes(HTMLAttributes, { class: 'block-editor-table' }), ['tbody', 0]]];
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const ctx = findParentTableContext(this.editor);
        if (!ctx) return false;
        const { tableNode, tableStart, rowIndex, colIndex } = ctx;
        const row = tableNode.child(rowIndex);
        let nextRow = rowIndex;
        let nextCol = colIndex + 1;
        if (nextCol >= row.childCount) {
          nextRow = rowIndex + 1;
          nextCol = 0;
        }
        if (nextRow >= tableNode.childCount) {
          return addTableRowAfter(this.editor);
        }
        const target = cellContentPos(this.editor, tableStart, nextRow, nextCol);
        if (target == null) return true;
        this.editor.view.dispatch(this.editor.state.tr.setSelection(TextSelection.create(this.editor.state.doc, target)).scrollIntoView());
        return true;
      },
      'Shift-Tab': () => {
        const ctx = findParentTableContext(this.editor);
        if (!ctx) return false;
        const { tableNode, tableStart, rowIndex, colIndex } = ctx;
        let prevRow = rowIndex;
        let prevCol = colIndex - 1;
        if (prevCol < 0) {
          prevRow = rowIndex - 1;
          if (prevRow < 0) return true;
          prevCol = tableNode.child(prevRow).childCount - 1;
        }
        const target = cellContentPos(this.editor, tableStart, prevRow, prevCol);
        if (target == null) return true;
        this.editor.view.dispatch(this.editor.state.tr.setSelection(TextSelection.create(this.editor.state.doc, target)).scrollIntoView());
        return true;
      },
      Enter: () => {
        const ctx = findParentTableContext(this.editor);
        if (!ctx) return false;
        const { tableNode, tableStart, tablePos, rowIndex, colIndex } = ctx;
        if (rowIndex + 1 < tableNode.childCount) {
          const target = cellContentPos(this.editor, tableStart, rowIndex + 1, colIndex);
          if (target != null) {
            this.editor.view.dispatch(this.editor.state.tr.setSelection(TextSelection.create(this.editor.state.doc, target)).scrollIntoView());
          }
          return true;
        }
        // At last row: exit table to a paragraph after the table
        const afterTable = tablePos + tableNode.nodeSize;
        const paragraphType = this.editor.state.schema.nodes.paragraph;
        const nextNode = this.editor.state.doc.nodeAt(afterTable);
        if (nextNode && nextNode.type.name === 'paragraph') {
          this.editor.view.dispatch(this.editor.state.tr.setSelection(TextSelection.create(this.editor.state.doc, afterTable + 1)).scrollIntoView());
          return true;
        }
        if (!paragraphType) return true;
        const tr = this.editor.state.tr.insert(afterTable, paragraphType.create());
        tr.setSelection(TextSelection.create(tr.doc, afterTable + 1));
        this.editor.view.dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },
});

export const TableRowNode = Node.create({
  name: 'tableRow',
  content: '(tableCell | tableHeader)+',
  tableRole: 'row',

  parseHTML() {
    return [{ tag: 'tr' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['tr', mergeAttributes(HTMLAttributes), 0];
  },
});

export const TableHeaderNode = Node.create({
  name: 'tableHeader',
  content: 'paragraph',
  tableRole: 'header_cell',
  isolating: true,

  parseHTML() {
    return [{ tag: 'th' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['th', mergeAttributes(HTMLAttributes), 0];
  },
});

export const TableCellNode = Node.create({
  name: 'tableCell',
  content: 'paragraph',
  tableRole: 'cell',
  isolating: true,

  parseHTML() {
    return [{ tag: 'td' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['td', mergeAttributes(HTMLAttributes), 0];
  },
});

export const TableExtensions = [TableNode, TableRowNode, TableHeaderNode, TableCellNode];

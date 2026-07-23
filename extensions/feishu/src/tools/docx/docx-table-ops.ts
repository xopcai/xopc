import type * as Lark from '@larksuiteoapi/node-sdk';

import type { FeishuBlockTable, FeishuDocxBlock } from './docx-types.js';

const MIN_COLUMN_WIDTH = 50;
const MAX_COLUMN_WIDTH = 400;
const DEFAULT_TABLE_WIDTH = 730;

type TableMutationResult = {
  success: true;
  block: unknown;
};

type TableRowDeletionResult = TableMutationResult & {
  rows_deleted: number;
};

type TableColumnDeletionResult = TableMutationResult & {
  columns_deleted: number;
};

function normalizeChildBlockIds(children: string[] | string | undefined): string[] {
  if (Array.isArray(children)) return children;
  return typeof children === 'string' ? [children] : [];
}

function omitParentId(block: FeishuDocxBlock): FeishuDocxBlock {
  const cleanBlock = { ...block };
  delete cleanBlock.parent_id;
  return cleanBlock;
}

function createDescendantTable(table: FeishuBlockTable, adaptiveWidths: number[] | undefined): FeishuBlockTable {
  const { row_size, column_size } = table.property || {};
  return {
    property: {
      row_size,
      column_size,
      ...(adaptiveWidths?.length ? { column_width: adaptiveWidths } : {}),
    },
  };
}

export function calculateAdaptiveColumnWidths(blocks: FeishuDocxBlock[], tableBlockId: string): number[] {
  const tableBlock = blocks.find((b) => b.block_id === tableBlockId && b.block_type === 31);
  if (!tableBlock?.table?.property) return [];

  const { row_size, column_size, column_width: originalWidths } = tableBlock.table.property;
  if (!row_size || !column_size) return [];

  const totalWidth =
    originalWidths && originalWidths.length > 0
      ? originalWidths.reduce((a: number, b: number) => a + b, 0)
      : DEFAULT_TABLE_WIDTH;

  const cellIds = normalizeChildBlockIds(tableBlock.children);
  const blockMap = new Map<string, FeishuDocxBlock>();
  for (const block of blocks) {
    if (block.block_id) blockMap.set(block.block_id, block);
  }

  function getCellText(cellId: string): string {
    const cell = blockMap.get(cellId);
    let text = '';
    const childIds = normalizeChildBlockIds(cell?.children as any);
    for (const childId of childIds) {
      const child = blockMap.get(childId);
      if (child?.text?.elements) {
        for (const elem of child.text.elements) {
          if (elem.text_run?.content) {
            text += elem.text_run.content;
          }
        }
      }
    }
    return text;
  }

  function getWeightedLength(text: string): number {
    return Array.from(text).reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 2 : 1), 0);
  }

  const maxLengths = Array.from({ length: column_size }, () => 0);
  for (let row = 0; row < row_size; row++) {
    for (let col = 0; col < column_size; col++) {
      const cellIndex = row * column_size + col;
      const cellId = cellIds[cellIndex];
      if (!cellId) continue;
      const content = getCellText(cellId);
      const length = getWeightedLength(content);
      maxLengths[col] = Math.max(maxLengths[col], length);
    }
  }

  const totalLength = maxLengths.reduce((a, b) => a + b, 0);
  if (totalLength === 0) {
    const equalWidth = Math.max(
      MIN_COLUMN_WIDTH,
      Math.min(MAX_COLUMN_WIDTH, Math.floor(totalWidth / column_size)),
    );
    return Array.from({ length: column_size }, () => equalWidth);
  }

  let widths = maxLengths.map((len) => Math.round((len / totalLength) * totalWidth));
  widths = widths.map((w) => Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, w)));

  let remaining = totalWidth - widths.reduce((a, b) => a + b, 0);
  while (remaining > 0) {
    const growable = widths.map((w, i) => (w < MAX_COLUMN_WIDTH ? i : -1)).filter((i) => i >= 0);
    if (growable.length === 0) break;
    const perColumn = Math.floor(remaining / growable.length);
    if (perColumn === 0) break;
    for (const i of growable) {
      const add = Math.min(perColumn, MAX_COLUMN_WIDTH - widths[i]!);
      widths[i]! += add;
      remaining -= add;
    }
  }

  return widths;
}

export function cleanBlocksForDescendant(blocks: FeishuDocxBlock[]): FeishuDocxBlock[] {
  const tableWidths = new Map<string, number[]>();
  for (const block of blocks) {
    if (block.block_type === 31 && block.block_id) {
      tableWidths.set(block.block_id, calculateAdaptiveColumnWidths(blocks, block.block_id));
    }
  }

  return blocks.map((block) => {
    const cleanBlock = omitParentId(block);
    if (cleanBlock.block_type === 32 && typeof cleanBlock.children === 'string') {
      cleanBlock.children = [cleanBlock.children];
    }
    if (cleanBlock.block_type === 31 && cleanBlock.table) {
      const adaptive = block.block_id ? tableWidths.get(block.block_id) : undefined;
      cleanBlock.table = createDescendantTable(cleanBlock.table, adaptive);
    }
    return cleanBlock;
  });
}

export async function insertTableRow(
  client: Lark.Client,
  docToken: string,
  blockId: string,
  rowIndex: number = -1,
): Promise<TableMutationResult> {
  const res = await client.docx.documentBlock.patch({
    path: { document_id: docToken, block_id: blockId },
    data: { insert_table_row: { row_index: rowIndex } },
  });
  if (res.code !== 0) throw new Error(res.msg);
  return { success: true, block: res.data?.block };
}

export async function insertTableColumn(
  client: Lark.Client,
  docToken: string,
  blockId: string,
  columnIndex: number = -1,
): Promise<TableMutationResult> {
  const res = await client.docx.documentBlock.patch({
    path: { document_id: docToken, block_id: blockId },
    data: { insert_table_column: { column_index: columnIndex } },
  });
  if (res.code !== 0) throw new Error(res.msg);
  return { success: true, block: res.data?.block };
}

export async function deleteTableRows(
  client: Lark.Client,
  docToken: string,
  blockId: string,
  rowStart: number,
  rowCount: number = 1,
): Promise<TableRowDeletionResult> {
  const res = await client.docx.documentBlock.patch({
    path: { document_id: docToken, block_id: blockId },
    data: { delete_table_rows: { row_start_index: rowStart, row_end_index: rowStart + rowCount } },
  });
  if (res.code !== 0) throw new Error(res.msg);
  return { success: true, rows_deleted: rowCount, block: res.data?.block };
}

export async function deleteTableColumns(
  client: Lark.Client,
  docToken: string,
  blockId: string,
  columnStart: number,
  columnCount: number = 1,
): Promise<TableColumnDeletionResult> {
  const res = await client.docx.documentBlock.patch({
    path: { document_id: docToken, block_id: blockId },
    data: { delete_table_columns: { column_start_index: columnStart, column_end_index: columnStart + columnCount } },
  });
  if (res.code !== 0) throw new Error(res.msg);
  return { success: true, columns_deleted: columnCount, block: res.data?.block };
}

export async function mergeTableCells(
  client: Lark.Client,
  docToken: string,
  blockId: string,
  rowStart: number,
  rowEnd: number,
  columnStart: number,
  columnEnd: number,
): Promise<TableMutationResult> {
  const res = await client.docx.documentBlock.patch({
    path: { document_id: docToken, block_id: blockId },
    data: {
      merge_table_cells: {
        row_start_index: rowStart,
        row_end_index: rowEnd,
        column_start_index: columnStart,
        column_end_index: columnEnd,
      },
    },
  });
  if (res.code !== 0) throw new Error(res.msg);
  return { success: true, block: res.data?.block };
}

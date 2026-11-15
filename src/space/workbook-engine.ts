import { createRequire } from 'node:module';

import type { ICellData, IWorkbookData } from '@univerjs/core';
import type { FUniver as UniverFacade } from '@univerjs/core/facade';
import type {} from '@univerjs/sheets/facade';
import type {} from '@univerjs/engine-formula/facade';
import type {} from '@univerjs/sheets-formula/facade';
import { spaceWorkbookRoute, type SpaceWorkbookCellChange, type SpaceWorkbookCellValue } from '@xopcai/gateway-contract';

import type { loadSpaceWorkbook } from './budget-workbook.js';

// Keep core, plugins and façade mixins on the same module path with Node and the development loader.
const require = createRequire(import.meta.url);
const { LocaleType, Univer } = require('@univerjs/core') as typeof import('@univerjs/core');
const { FUniver } = require('@univerjs/core/facade') as typeof import('@univerjs/core/facade');
const { UniverFormulaEnginePlugin } = require('@univerjs/engine-formula') as typeof import('@univerjs/engine-formula');
const { UniverSheetsPlugin } = require('@univerjs/sheets') as typeof import('@univerjs/sheets');
const { UniverSheetsFormulaPlugin } = require('@univerjs/sheets-formula') as typeof import('@univerjs/sheets-formula');
require('@univerjs/sheets/facade');
require('@univerjs/engine-formula/facade');
require('@univerjs/sheets-formula/facade');

type StoredWorkbook = NonNullable<ReturnType<typeof loadSpaceWorkbook>>;
type Workbook = ReturnType<UniverFacade['createWorkbook']>;
type Sheet = ReturnType<Workbook['getSheets']>[number];

export type WorkbookEdit = { sheet: string; cell: string; value: SpaceWorkbookCellValue; formula?: string };

const cellPattern = /^[A-Z]{1,2}[1-9]\d{0,3}$/;
const rangePattern = /^[A-Z]{1,2}[1-9]\d{0,3}(?::[A-Z]{1,2}[1-9]\d{0,3})?$/;
const timeoutMs = 5_000;

function scalar(value: unknown): SpaceWorkbookCellValue {
  if (typeof value === 'string') return value.slice(0, 500);
  if (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function getRange(book: Workbook, sheetRef: string, address: string, singleCell = false) {
  const sheet = book.getSheetBySheetId(sheetRef) ?? book.getSheetByName(sheetRef);
  const normalized = address.toUpperCase();
  if (!sheet || !(singleCell ? cellPattern : rangePattern).test(normalized)) throw new Error('Specify an existing worksheet and an A1 cell or range.');
  const range = sheet.getRange(normalized);
  if (range.getLastRow() >= sheet.getMaxRows() || range.getLastColumn() >= sheet.getMaxColumns()) {
    throw new Error('The range is outside the worksheet.');
  }
  return { sheet, range, address: normalized };
}

async function withCalculatedWorkbook<T>(stored: StoredWorkbook, operation: (book: Workbook, formula: ReturnType<UniverFacade['getFormula']>, recalculate: () => Promise<void>) => Promise<T>) {
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: {} } });
  try {
    univer.registerPlugin(UniverFormulaEnginePlugin);
    univer.registerPlugin(UniverSheetsPlugin);
    univer.registerPlugin(UniverSheetsFormulaPlugin);
    const api = FUniver.newAPI(univer);
    const book = api.createWorkbook(structuredClone(stored.snapshot) as unknown as IWorkbookData);
    const formula = api.getFormula();
    const recalculate = async () => {
      const applied = formula.onCalculationResultApplied(timeoutMs);
      formula.executeCalculation();
      await applied;
    };
    await recalculate();
    return await operation(book, formula, recalculate);
  } finally {
    univer.dispose();
  }
}

function columnLabel(index: number): string {
  const last = String.fromCharCode(65 + index % 26);
  return index < 26 ? last : `${String.fromCharCode(64 + Math.floor(index / 26))}${last}`;
}

function locate(stored: StoredWorkbook, sheetId: string, address: string) {
  return `#${spaceWorkbookRoute(stored.id, stored.versionId, { sheetId, range: address })}`;
}

export async function readWorkbookForAgent(stored: StoredWorkbook, target?: { sheet: string; range: string; trace?: boolean }) {
  const overview = { title: stored.title, versionId: stored.versionId, link: `#${spaceWorkbookRoute(stored.id, stored.versionId)}` };
  if (!target) return {
    ...overview,
    sheets: stored.snapshot.sheetOrder.flatMap(id => {
      const sheet = stored.snapshot.sheets[id];
      if (sheet.hidden === 1) return [];
      return [{ id, name: sheet.name, rows: sheet.rowCount, columns: sheet.columnCount, link: locate(stored, id, 'A1') }];
    }),
  };
  return withCalculatedWorkbook(stored, async (book, formula) => {
    const { sheet, range, address } = getRange(book, target.sheet, target.range);
    if (sheet.isSheetHidden()) throw new Error('Choose a visible worksheet.');
    if (range.getHeight() * range.getWidth() > 200) throw new Error('Read at most 200 cells per call.');
    const values = range.getValues().map(row => row.map(scalar));
    const formulas = range.getFormulas().map(row => row.map(value => value?.slice(0, 500) ?? ''));
    if (Buffer.byteLength(JSON.stringify([values, formulas])) > 12_000) throw new Error('Read a smaller range to fit the workbook context limit.');
    const tree = target.trace && cellPattern.test(address) && formulas[0][0]
      ? await formula.getCellDependencyTree({ unitId: book.getId(), sheetId: sheet.getSheetId(), row: range.getRow(), column: range.getColumn() }, timeoutMs)
      : undefined;
    const references = tree?.rangeList.flatMap(ref => {
      const source = ref.unitId === book.getId() ? book.getSheetBySheetId(ref.sheetId) : null;
      if (!source || source.isSheetHidden()) return [];
      const { startRow, endRow, startColumn, endColumn } = ref.range;
      const first = `${columnLabel(startColumn)}${startRow + 1}`;
      const last = `${columnLabel(endColumn)}${endRow + 1}`;
      const a1 = first === last ? first : `${first}:${last}`;
      return [{ sheet: source.getSheetName(), range: a1, link: locate(stored, source.getSheetId(), a1) }];
    }).slice(0, 20);
    return { ...overview, sheet: sheet.getSheetName(), range: address, link: locate(stored, sheet.getSheetId(), address), values, formulas, references };
  });
}

function describeCell(sheet: Sheet, cell: string) {
  const range = sheet.getRange(cell);
  const value = scalar(range.getValue());
  const formula = range.getFormula() || undefined;
  return { value, formula };
}

export function simulateWorkbookEdits(stored: StoredWorkbook, edits: readonly WorkbookEdit[]) {
  return withCalculatedWorkbook(stored, async (book, _formula, recalculate) => {
    const targets = edits.map(edit => {
      const { sheet, range, address } = getRange(book, edit.sheet, edit.cell, true);
      if (sheet.isSheetHidden()) throw new Error('Choose a visible worksheet.');
      const prior = range.getCellData();
      if (prior?.si || prior?.p || range.isMerged()) throw new Error('This cell requires editing directly in the workbook.');
      return { edit, sheet, address, range, before: describeCell(sheet, address) };
    });
    const keys = new Set(targets.map(({ sheet, address }) => `${sheet.getSheetId()}!${address}`));
    if (keys.size !== targets.length) throw new Error('Specify each cell once.');
    const previous = book.save();
    for (const { edit, range } of targets) {
      if (edit.formula) range.setFormula(edit.formula);
      else if (edit.value === null) range.clearContent();
      else range.setValue({ v: edit.value, f: null });
    }
    await recalculate();
    const describe = ({ sheet, address, before }: (typeof targets)[number]): SpaceWorkbookCellChange => {
      const after = describeCell(sheet, address);
      return { sheetId: sheet.getSheetId(), sheetName: sheet.getSheetName(), cell: address,
        before: before.value, after: after.value, beforeFormula: before.formula, afterFormula: after.formula };
    };
    const changed = (cell: SpaceWorkbookCellChange) => cell.before !== cell.after || cell.beforeFormula !== cell.afterFormula;
    const changes = targets.map(describe).filter(changed);
    const snapshot = book.save();
    const effects: SpaceWorkbookCellChange[] = [];
    // The range dependency API returns direct dependents. Compare calculated snapshots for downstream effects.
    for (const sheetId of snapshot.sheetOrder) {
      const sheet = snapshot.sheets[sheetId];
      if (sheet.hidden === 1) continue;
      for (const [row, cells] of Object.entries(sheet.cellData ?? {})) {
        for (const [column, cell] of Object.entries<ICellData | null>(cells ?? {})) {
          const old = previous.sheets[sheetId]?.cellData?.[Number(row)]?.[Number(column)];
          const address = `${columnLabel(Number(column))}${Number(row) + 1}`;
          if (!cell?.f || old?.v === cell.v || keys.has(`${sheetId}!${address}`)) continue;
          effects.push({ sheetId, sheetName: sheet.name ?? sheetId, cell: address, before: scalar(old?.v), after: scalar(cell.v),
            beforeFormula: typeof old?.f === 'string' ? old.f : undefined, afterFormula: cell.f });
        }
      }
    }
    const requiresReview = targets.length > 1 || targets.some(({ edit, before }) =>
      Boolean(edit.formula || before.formula || edit.value === null))
      || effects.some(cell => typeof cell.after === 'string' && /^#(?:REF!|VALUE!|DIV\/0!|N\/A|NAME\?|NUM!|SPILL!|CYCLE!|NULL!)/.test(cell.after));
    return { changes, effects: effects.slice(0, 30), affectedCount: effects.length, requiresReview, snapshot };
  });
}

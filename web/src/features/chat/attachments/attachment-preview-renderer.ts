/**
 * Full-document preview for the attachment dialog (PDF canvas / DOCX HTML / Excel table).
 * Kept separate from the dialog shell so Vite can split this into async chunks.
 */

import {
  EXCEL_PREVIEW_MAX_COLS,
  EXCEL_PREVIEW_MAX_ROWS,
} from '@/features/chat/attachments/attachment-utils-core';
import { isRenderableWorksheet } from '@/features/chat/attachments/excel-worksheet-utils';

let pdfWorkerConfigured = false;

/** First paint: render this many pages, then lazy-load the rest when the viewport nears the sentinel. */
const PDF_INITIAL_PAGE_COUNT = 5;
const PDF_LAZY_PAGE_BATCH = 5;

async function ensurePdfWorker(): Promise<typeof import('pdfjs-dist')> {
  const pdfjsLib = await import('pdfjs-dist');
  if (!pdfWorkerConfigured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
    pdfWorkerConfigured = true;
  }
  return pdfjsLib;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export type RenderPdfInContainerOptions = {
  loadingText?: string;
  loadMoreHint?: string;
  onPageCount?: (count: number) => void;
};

export async function renderPdfInContainer(
  container: HTMLDivElement,
  arrayBuffer: ArrayBuffer,
  options?: RenderPdfInContainerOptions,
): Promise<{ cleanup: () => void }> {
  const pdfjsLib = await ensurePdfWorker();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  let pendingLoadTask: { destroy: () => void } | null = loadingTask;

  container.innerHTML = '';
  const loadingEl = document.createElement('p');
  loadingEl.className = 'p-4 text-sm text-fg-muted';
  loadingEl.textContent = options?.loadingText ?? '…';
  container.appendChild(loadingEl);

  let pdf: import('pdfjs-dist').PDFDocumentProxy | null = null;
  let observer: IntersectionObserver | null = null;

  try {
    pdf = await loadingTask.promise;
  } catch (e) {
    pendingLoadTask?.destroy();
    pendingLoadTask = null;
    throw e;
  }
  pendingLoadTask = null;

  container.innerHTML = '';
  const wrapper = document.createElement('div');
  container.appendChild(wrapper);
  const pagesHost = document.createElement('div');
  wrapper.appendChild(pagesHost);

  const renderPageElement = async (pageNum: number, numPagesTotal: number) => {
    if (!pdf) return null;
    const page = await pdf.getPage(pageNum);

    const pageContainer = document.createElement('div');
    pageContainer.className = 'mb-4 last:mb-0';
    pageContainer.dataset.pdfPage = String(pageNum);

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    const viewport = page.getViewport({ scale: 1.5 });
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    canvas.className =
      'mx-auto block h-auto w-full max-w-full rounded border border-edge bg-white shadow-sm dark:border-edge';

    if (context) {
      context.fillStyle = 'white';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    await page
      .render({
        canvasContext: context!,
        viewport,
        canvas: canvas,
      })
      .promise;

    pageContainer.appendChild(canvas);

    if (pageNum < numPagesTotal) {
      const separator = document.createElement('div');
      separator.className = 'my-4 h-px bg-edge';
      pageContainer.appendChild(separator);
    }

    return pageContainer;
  };

  const appendRenderedPages = async (pageNums: number[], numPagesTotal: number) => {
    const rendered = await Promise.all(
      pageNums.map((pageNum) => renderPageElement(pageNum, numPagesTotal)),
    );
    for (const pageContainer of rendered) {
      if (pageContainer) pagesHost.appendChild(pageContainer);
    }
    await yieldToBrowser();
  };

  const numPages = pdf.numPages;
  options?.onPageCount?.(numPages);
  const initialEnd = Math.min(PDF_INITIAL_PAGE_COUNT, numPages);

  if (initialEnd > 0) {
    await appendRenderedPages(
      Array.from({ length: initialEnd }, (_, i) => i + 1),
      numPages,
    );
  }

  let nextPage = initialEnd + 1;

  if (nextPage <= numPages) {
    const hint = document.createElement('p');
    hint.className = 'py-2 text-center text-xs text-fg-muted';
    hint.textContent = options?.loadMoreHint ?? '';
    wrapper.appendChild(hint);

    const sentinel = document.createElement('div');
    sentinel.className = 'pdf-lazy-sentinel h-12 w-full shrink-0';
    sentinel.setAttribute('aria-hidden', 'true');
    wrapper.appendChild(sentinel);

    let loadingMore = false;
    observer = new IntersectionObserver(
      async (entries) => {
        if (!entries[0]?.isIntersecting || loadingMore || !pdf) return;
        loadingMore = true;
        try {
          const batchEnd = Math.min(nextPage + PDF_LAZY_PAGE_BATCH - 1, numPages);
          const batchPageNums = Array.from(
            { length: batchEnd - nextPage + 1 },
            (_, i) => nextPage + i,
          );
          await appendRenderedPages(batchPageNums, numPages);
          nextPage = batchEnd + 1;
          if (nextPage > numPages) {
            observer?.disconnect();
            observer = null;
            hint.remove();
            sentinel.remove();
          }
        } finally {
          loadingMore = false;
        }
      },
      { root: container, rootMargin: '320px', threshold: 0 },
    );
    observer.observe(sentinel);
  }

  return {
    cleanup: () => {
      observer?.disconnect();
      observer = null;
      if (pendingLoadTask) {
        try {
          pendingLoadTask.destroy();
        } catch {
          /* ignore */
        }
        pendingLoadTask = null;
      }
      if (pdf) {
        void loadingTask.destroy();
        pdf = null;
      }
      container.innerHTML = '';
    },
  };
}

export async function renderDocxInContainer(
  container: HTMLDivElement,
  arrayBuffer: ArrayBuffer,
): Promise<{ cleanup: () => void }> {
  const { renderAsync, defaultOptions } = await import('docx-preview');

  container.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'docx-wrapper-custom max-w-full overflow-x-auto';
  container.appendChild(wrapper);

  await renderAsync(arrayBuffer, wrapper, undefined, {
    ...defaultOptions,
    className: 'docx',
    inWrapper: true,
    ignoreWidth: true,
    ignoreHeight: false,
    // Embedded Word fonts often fail to load in the browser; ignoring them uses system fonts so CJK/Latin render correctly.
    ignoreFonts: true,
    breakPages: true,
    ignoreLastRenderedPageBreak: true,
    experimental: false,
    trimXmlDeclaration: true,
    useBase64URL: false,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
  });

  const style = document.createElement('style');
  style.textContent = `
    .docx-preview-host { padding: 0; }
    .docx-preview-host .docx-wrapper-custom { max-width: 100%; overflow-x: auto; }
    .docx-preview-host .docx-wrapper { max-width: 100% !important; margin: 0 !important; background: transparent !important; padding: 0em !important; }
    .docx-preview-host .docx-wrapper > section.docx { box-shadow: none !important; border: none !important; border-radius: 0 !important; margin: 0 !important; padding: 2em !important; background: white !important; color: black !important; max-width: 100% !important; width: 100% !important; min-width: 0 !important; overflow-x: auto !important; font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans CJK JP", sans-serif !important; }
    .docx-preview-host table { max-width: 100% !important; width: auto !important; overflow-x: auto !important; display: block !important; font-family: inherit !important; }
    .docx-preview-host img { max-width: 100% !important; height: auto !important; }
    .docx-preview-host p, .docx-preview-host span, .docx-preview-host div, .docx-preview-host td, .docx-preview-host th { max-width: 100% !important; word-wrap: break-word !important; overflow-wrap: break-word !important; font-family: inherit !important; }
    .docx-preview-host .docx-page-break { display: none !important; }
  `;
  container.classList.add('docx-preview-host');
  container.appendChild(style);

  return {
    cleanup: () => {
      container.innerHTML = '';
      container.classList.remove('docx-preview-host');
    },
  };
}

export type RenderExcelInContainerOptions = {
  truncationNotice?: string;
};

export async function renderExcelInContainer(
  container: HTMLDivElement,
  arrayBuffer: ArrayBuffer,
  options?: RenderExcelInContainerOptions,
): Promise<{ cleanup: () => void; truncated: boolean }> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(arrayBuffer, {
    type: 'array',
    cellDates: true,
    cellStyles: true,
  });

  container.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'flex h-full min-h-0 flex-col overflow-hidden bg-white';
  container.appendChild(wrapper);

  const names = workbook.SheetNames ?? [];
  if (names.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'p-4 text-sm text-fg-muted';
    empty.textContent = '(No sheets in workbook.)';
    wrapper.appendChild(empty);
    return {
      truncated: false,
      cleanup: () => {
        container.innerHTML = '';
      },
    };
  }

  let anyTruncated = false;

  if (names.length > 1) {
    const tabContainer = document.createElement('div');
    tabContainer.className =
      'z-30 flex shrink-0 gap-1 overflow-x-auto border-b border-edge bg-surface-panel px-2 pt-1 dark:border-edge';

    const sheetContents: HTMLElement[] = [];

    names.forEach((sheetName, index) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.textContent = sheetName;
      tab.className =
        index === 0
          ? 'shrink-0 border-b-2 border-accent px-3 py-2 text-xs font-medium text-accent'
          : 'shrink-0 border-b-2 border-transparent px-3 py-2 text-xs font-medium text-fg-muted hover:border-edge hover:text-fg';

      const sheetDiv = document.createElement('div');
      sheetDiv.style.display = index === 0 ? 'flex' : 'none';
      sheetDiv.className = 'min-h-0 flex-1 overflow-hidden';
      const built = buildExcelSheetDomWithXlsx(
        XLSX,
        workbook.Sheets[sheetName],
        sheetName,
        options?.truncationNotice,
      );
      if (built.truncated) anyTruncated = true;
      sheetDiv.appendChild(built.element);
      sheetContents.push(sheetDiv);

      tab.onclick = () => {
        tabContainer.querySelectorAll('button').forEach((btn, btnIndex) => {
          if (btnIndex === index) {
            btn.className =
              'shrink-0 border-b-2 border-accent px-3 py-2 text-xs font-medium text-accent';
          } else {
            btn.className =
              'shrink-0 border-b-2 border-transparent px-3 py-2 text-xs font-medium text-fg-muted hover:border-edge hover:text-fg';
          }
        });
        sheetContents.forEach((content, contentIndex) => {
          content.style.display = contentIndex === index ? 'flex' : 'none';
        });
      };

      tabContainer.appendChild(tab);
    });

    wrapper.appendChild(tabContainer);
    sheetContents.forEach((content) => {
      wrapper.appendChild(content);
    });
  } else {
    const sheetName = names[0];
    const built = buildExcelSheetDomWithXlsx(
      XLSX,
      workbook.Sheets[sheetName],
      sheetName,
      options?.truncationNotice,
    );
    anyTruncated = built.truncated;
    wrapper.appendChild(built.element);
  }

  return {
    truncated: anyTruncated,
    cleanup: () => {
      container.innerHTML = '';
    },
  };
}

type ExcelMergeInfo = {
  colSpan: number;
  rowSpan: number;
};

const EXCEL_DEFAULT_COLUMN_WIDTH_PX = 80;
const EXCEL_ROW_HEADER_WIDTH_PX = 46;
const EXCEL_MIN_COLUMN_WIDTH_PX = 28;
const EXCEL_MAX_COLUMN_WIDTH_PX = 480;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function excelColumnWidthPx(col: import('xlsx').ColInfo | undefined): number {
  if (!col) return EXCEL_DEFAULT_COLUMN_WIDTH_PX;
  if (typeof col.wpx === 'number' && Number.isFinite(col.wpx)) {
    return clamp(col.wpx, EXCEL_MIN_COLUMN_WIDTH_PX, EXCEL_MAX_COLUMN_WIDTH_PX);
  }
  const characters = col.wch ?? col.width;
  if (typeof characters === 'number' && Number.isFinite(characters)) {
    return clamp(Math.round(characters * 7 + 12), EXCEL_MIN_COLUMN_WIDTH_PX, EXCEL_MAX_COLUMN_WIDTH_PX);
  }
  return EXCEL_DEFAULT_COLUMN_WIDTH_PX;
}

function excelRowHeightPx(row: import('xlsx').RowInfo | undefined): number | undefined {
  if (!row) return undefined;
  if (typeof row.hpx === 'number' && Number.isFinite(row.hpx)) return clamp(row.hpx, 16, 240);
  if (typeof row.hpt === 'number' && Number.isFinite(row.hpt)) {
    return clamp(Math.round(row.hpt * (96 / 72)), 16, 240);
  }
  return undefined;
}

function normalizedFillColor(cell: import('xlsx').CellObject | undefined): string | undefined {
  const style = cell?.s as { patternType?: string; fgColor?: { rgb?: string } } | undefined;
  if (!style?.fgColor?.rgb || style.patternType === 'none') return undefined;
  const rgb = style.fgColor.rgb.replace(/^#/, '').slice(-6);
  return /^[0-9a-f]{6}$/i.test(rgb) ? `#${rgb}` : undefined;
}

function readableTextColor(background: string): string {
  const rgb = background.slice(1).match(/.{2}/g)?.map((channel) => Number.parseInt(channel, 16));
  if (!rgb || rgb.length !== 3) return '#0f172a';
  const luminance = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
  return luminance < 132 ? '#ffffff' : '#0f172a';
}

function cellDisplayText(
  XLSX: typeof import('xlsx'),
  cell: import('xlsx').CellObject | undefined,
): string {
  if (!cell || cell.t === 'z') return '';
  if (typeof cell.w === 'string') return cell.w;
  try {
    return XLSX.utils.format_cell(cell);
  } catch {
    return cell.v == null ? '' : String(cell.v);
  }
}

function buildMergeMaps(
  merges: import('xlsx').Range[],
  startRow: number,
  endRow: number,
  startCol: number,
  endCol: number,
): { anchors: Map<string, ExcelMergeInfo>; covered: Set<string> } {
  const anchors = new Map<string, ExcelMergeInfo>();
  const covered = new Set<string>();

  for (const merge of merges) {
    const top = Math.max(startRow, merge.s.r);
    const bottom = Math.min(endRow, merge.e.r);
    const left = Math.max(startCol, merge.s.c);
    const right = Math.min(endCol, merge.e.c);
    if (top > bottom || left > right) continue;

    const anchorKey = `${top}:${left}`;
    anchors.set(anchorKey, {
      rowSpan: bottom - top + 1,
      colSpan: right - left + 1,
    });
    for (let row = top; row <= bottom; row += 1) {
      for (let col = left; col <= right; col += 1) {
        if (row !== top || col !== left) covered.add(`${row}:${col}`);
      }
    }
  }

  return { anchors, covered };
}

export function buildExcelSheetDomWithXlsx(
  XLSX: typeof import('xlsx'),
  worksheet: import('xlsx').WorkSheet | undefined,
  sheetName: string,
  truncationNotice?: string,
): { element: HTMLElement; truncated: boolean } {
  const sheetDiv = document.createElement('div');
  sheetDiv.className = 'min-h-0 flex-1 overflow-auto bg-white';

  if (!worksheet) {
    const p = document.createElement('p');
    p.className = 'p-4 text-sm text-fg-muted';
    p.textContent = `Sheet "${sheetName}" is missing from the workbook.`;
    sheetDiv.appendChild(p);
    return { element: sheetDiv, truncated: false };
  }

  if (!isRenderableWorksheet(worksheet)) {
    const p = document.createElement('p');
    p.className = 'p-4 text-sm text-fg-muted';
    p.textContent = '(Empty sheet — no cell range.)';
    sheetDiv.appendChild(p);
    return { element: sheetDiv, truncated: false };
  }

  try {
    const range = XLSX.utils.decode_range(worksheet['!ref']!);
    const rowCount = range.e.r - range.s.r + 1;
    const colCount = range.e.c - range.s.c + 1;
    const endRow = Math.min(range.e.r, range.s.r + EXCEL_PREVIEW_MAX_ROWS - 1);
    const endCol = Math.min(range.e.c, range.s.c + EXCEL_PREVIEW_MAX_COLS - 1);
    const truncated = rowCount > EXCEL_PREVIEW_MAX_ROWS || colCount > EXCEL_PREVIEW_MAX_COLS;

    if (truncated && truncationNotice) {
      const note = document.createElement('p');
      note.className = 'mb-2 border-b border-edge-subtle px-1 pb-2 text-xs text-fg-muted dark:border-edge';
      note.textContent = truncationNotice;
      sheetDiv.appendChild(note);
    }

    const table = document.createElement('table');
    table.className = 'table-fixed border-separate border-spacing-0 bg-white text-slate-900';
    table.setAttribute('aria-label', sheetName);

    const colGroup = document.createElement('colgroup');
    const rowHeaderCol = document.createElement('col');
    rowHeaderCol.style.width = `${EXCEL_ROW_HEADER_WIDTH_PX}px`;
    colGroup.appendChild(rowHeaderCol);
    let tableWidth = EXCEL_ROW_HEADER_WIDTH_PX;
    for (let col = range.s.c; col <= endCol; col += 1) {
      const width = excelColumnWidthPx(worksheet['!cols']?.[col]);
      const colElement = document.createElement('col');
      colElement.style.width = `${width}px`;
      colGroup.appendChild(colElement);
      tableWidth += width;
    }
    table.style.width = `${tableWidth}px`;
    table.appendChild(colGroup);

    const thead = document.createElement('thead');
    const columnHeaderRow = document.createElement('tr');
    const corner = document.createElement('th');
    corner.className =
      'sticky left-0 top-0 z-30 border-b border-r border-slate-300 bg-slate-100 text-[11px] font-medium text-slate-500';
    corner.setAttribute('aria-hidden', 'true');
    columnHeaderRow.appendChild(corner);
    for (let col = range.s.c; col <= endCol; col += 1) {
      const header = document.createElement('th');
      header.className =
        'sticky top-0 z-20 h-7 border-b border-r border-slate-300 bg-slate-100 px-2 text-center text-[11px] font-medium text-slate-600';
      header.scope = 'col';
      header.textContent = XLSX.utils.encode_col(col);
      columnHeaderRow.appendChild(header);
    }
    thead.appendChild(columnHeaderRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const { anchors, covered } = buildMergeMaps(
      worksheet['!merges'] ?? [],
      range.s.r,
      endRow,
      range.s.c,
      endCol,
    );

    for (let row = range.s.r; row <= endRow; row += 1) {
      const tr = document.createElement('tr');
      const rowHeight = excelRowHeightPx(worksheet['!rows']?.[row]);
      if (rowHeight) tr.style.height = `${rowHeight}px`;

      const rowHeader = document.createElement('th');
      rowHeader.className =
        'sticky left-0 z-10 w-[46px] border-b border-r border-slate-300 bg-slate-100 px-1 text-center text-[11px] font-medium text-slate-500';
      rowHeader.scope = 'row';
      rowHeader.textContent = String(row + 1);
      tr.appendChild(rowHeader);

      for (let col = range.s.c; col <= endCol; col += 1) {
        const key = `${row}:${col}`;
        if (covered.has(key)) continue;

        const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: col })] as
          | import('xlsx').CellObject
          | undefined;
        const merge = anchors.get(key);
        const text = cellDisplayText(XLSX, cell);
        const fillColor = normalizedFillColor(cell);
        const td = document.createElement('td');
        td.className =
          'overflow-hidden border-b border-r border-slate-200 px-2 py-1 text-xs leading-5';
        td.colSpan = merge?.colSpan ?? 1;
        td.rowSpan = merge?.rowSpan ?? 1;
        td.style.verticalAlign = 'middle';
        td.style.textAlign = merge ? 'center' : cell?.t === 'n' || cell?.t === 'd' ? 'right' : 'left';
        if (fillColor) {
          td.style.backgroundColor = fillColor;
          td.style.color = readableTextColor(fillColor);
        }
        if (text.includes('\n')) td.style.whiteSpace = 'pre-wrap';
        else td.style.whiteSpace = 'nowrap';
        if (text) td.title = cell?.f ? `${text}\n=${cell.f}` : text;
        td.textContent = text;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    sheetDiv.appendChild(table);
    return { element: sheetDiv, truncated };
  } catch (e) {
    const p = document.createElement('p');
    p.className = 'p-4 text-sm text-red-600 dark:text-red-400';
    p.textContent = e instanceof Error ? e.message : String(e);
    sheetDiv.appendChild(p);
    return { element: sheetDiv, truncated: false };
  }
}

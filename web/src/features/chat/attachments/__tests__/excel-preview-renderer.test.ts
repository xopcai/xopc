// @vitest-environment jsdom

import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';

import { buildExcelSheetDomWithXlsx } from '../attachment-preview-renderer';

describe('Excel preview renderer', () => {
  it('preserves sheet geometry, merged cells, formatted values, and basic fills', () => {
    const worksheet: XLSX.WorkSheet = {
      '!ref': 'A1:C3',
      '!cols': [{ wpx: 120 }, { wpx: 72 }, { wpx: 90 }],
      '!rows': [{ hpx: 36 }],
      '!merges': [XLSX.utils.decode_range('A1:C1')],
      A1: {
        t: 's',
        v: 'Quarterly report',
        s: { patternType: 'solid', fgColor: { rgb: 'FF1E3A5F' } },
      },
      A2: { t: 's', v: 'Revenue' },
      B2: { t: 'n', v: 1234.5, w: '1,234.50', f: 'SUM(B3:B4)' },
      C2: { t: 'd', v: new Date('2026-09-02T00:00:00Z'), w: '2026/9/2' },
      A3: { t: 's', v: 'Notes' },
    };

    const { element, truncated } = buildExcelSheetDomWithXlsx(XLSX, worksheet, 'Summary');

    expect(truncated).toBe(false);
    const table = element.querySelector('table');
    expect(table?.getAttribute('aria-label')).toBe('Summary');
    expect(table?.style.width).toBe('328px');
    expect([...element.querySelectorAll<HTMLElement>('col')].map((col) => col.style.width)).toEqual([
      '46px',
      '120px',
      '72px',
      '90px',
    ]);
    expect([...element.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual([
      '',
      'A',
      'B',
      'C',
    ]);

    const mergedHeading = [...element.querySelectorAll('td')].find(
      (cell) => cell.textContent === 'Quarterly report',
    );
    expect(mergedHeading?.colSpan).toBe(3);
    expect(mergedHeading?.style.textAlign).toBe('center');
    expect(mergedHeading?.style.backgroundColor).toBe('rgb(30, 58, 95)');
    expect(mergedHeading?.style.color).toBe('rgb(255, 255, 255)');

    const formattedNumber = [...element.querySelectorAll('td')].find(
      (cell) => cell.textContent === '1,234.50',
    );
    expect(formattedNumber?.style.textAlign).toBe('right');
    expect(formattedNumber?.title).toBe('1,234.50\n=SUM(B3:B4)');
    expect(element.querySelector<HTMLTableRowElement>('tbody tr')?.style.height).toBe('36px');
  });

  it('caps oversized sheets while keeping the original row coordinates', () => {
    const worksheet: XLSX.WorkSheet = {
      '!ref': 'C5:C505',
      C5: { t: 's', v: 'first' },
      C505: { t: 's', v: 'outside preview' },
    };

    const { element, truncated } = buildExcelSheetDomWithXlsx(
      XLSX,
      worksheet,
      'Large sheet',
      'Preview truncated',
    );

    expect(truncated).toBe(true);
    expect(element.querySelector('p')?.textContent).toBe('Preview truncated');
    expect(element.querySelector('thead th:last-child')?.textContent).toBe('C');
    const rowHeaders = [...element.querySelectorAll('tbody th')];
    expect(rowHeaders).toHaveLength(500);
    expect(rowHeaders[0]?.textContent).toBe('5');
    expect(rowHeaders.at(-1)?.textContent).toBe('504');
    expect(element.textContent).not.toContain('outside preview');
  });
});

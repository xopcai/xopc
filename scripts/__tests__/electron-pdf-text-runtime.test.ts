import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { buildPersonalResultWorker } from '../build-personal-result-worker.mjs';
import { pruneElectronPdfjsRuntime } from '../prune-electron-pdfjs-runtime.mjs';

function pdfFixture(contents: string) {
  const cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n4 beginbfchar\n<41> <4E2D>\n<42> <6587>\n<43> <D83DDE00>\n<44> <0041>\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 6 0 R >>',
    `<< /Length ${contents.length} >>\nstream\n${contents}\nendstream`,
    `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  return `${pdf}xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
}

it('extracts PDF text in the packaged worker without Canvas or browser globals', async () => {
  const root = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), 'xopc-pdf-text-runtime-'));
  try {
    mkdirSync(join(dir, 'node_modules'));
    cpSync(join(root, 'node_modules/pdfjs-dist'), join(dir, 'node_modules/pdfjs-dist'), { recursive: true, dereference: true });
    pruneElectronPdfjsRuntime(dir);
    expect(existsSync(join(dir, 'node_modules/@napi-rs/canvas'))).toBe(false);
    await buildPersonalResultWorker(root, join(dir, 'result-extraction.mjs'));
    writeFileSync(join(dir, 'check.mjs'), `
      import assert from 'node:assert/strict';
      import { createRequire } from 'node:module';
      assert.throws(() => createRequire(import.meta.url).resolve('@napi-rs/canvas'), { code: 'MODULE_NOT_FOUND' });
      import { extractResult } from './result-extraction.mjs';
      assert.equal(typeof globalThis.DOMMatrix, 'undefined');
      assert.equal(typeof globalThis.Path2D, 'undefined');
      const result = await extractResult({ file: process.argv[2], title: 'fixture.pdf' });
      assert.equal(typeof globalThis.DOMMatrix, 'undefined');
      console.log('RESULT:' + JSON.stringify(result));
    `);
    const env = { ...process.env };
    delete env.NODE_PATH;
    delete env.NODE_OPTIONS;
    const run = (path: string) => spawnSync(process.execPath, [join(dir, 'check.mjs'), path], { encoding: 'utf8', timeout: 30_000, env });
    const result = run(join(root, 'skills/creative/theme-factory/theme-showcase.pdf'));
    expect(result.status, result.stderr).toBe(0);
    const extracted = JSON.parse(result.stdout.split('RESULT:')[1]!);
    expect(extracted.unsupported).toBe(false);
    expect(extracted.text).toContain('Ocean Depths');
    expect(extracted.sections).toHaveLength(10);
    expect(extracted.sections.at(-1).locator).toEqual({ kind: 'page', page: 10 });
    expect(extracted.limitations.join(' ')).toContain('not verified');

    const unicode = join(dir, 'unicode.pdf');
    writeFileSync(unicode, pdfFixture('BT /F1 12 Tf 72 720 Td <41424344> Tj ET'));
    const unicodeResult = run(unicode);
    expect(unicodeResult.status, unicodeResult.stderr).toBe(0);
    expect(JSON.parse(unicodeResult.stdout.split('RESULT:')[1]!).text.trim()).toBe('中文😀A');

    const blank = join(dir, 'blank.pdf');
    writeFileSync(blank, pdfFixture(''));
    const blankResult = run(blank);
    expect(blankResult.status, blankResult.stderr).toBe(0);
    expect(JSON.parse(blankResult.stdout.split('RESULT:')[1]!)).toMatchObject({ unsupported: true });

    const invalid = join(dir, 'invalid.pdf');
    writeFileSync(invalid, 'This is not a PDF');
    const rejected = run(invalid);
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain('Invalid PDF');
    expect(rejected.stderr).not.toContain('DOMMatrix is not defined');

    // The source package remains suitable for browser preview builds.
    expect(readFileSync(join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'), 'utf8'))
      .toContain('const SCALE_MATRIX = new DOMMatrix();');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);

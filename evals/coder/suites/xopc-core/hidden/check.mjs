import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const expected = {
  "R01-price-comparison": {
    "vendorACents": 240,
    "vendorBCents": 360,
    "cheaper": "a",
    "sourceIds": [
      "primary-a",
      "primary-b"
    ],
    "asOf": "2026-10-01"
  },
  "R02-conflicting-source": {
    "acceptedCentsPerHour": 120,
    "rejectedSourceId": "secondary-note",
    "evidenceSourceId": "primary-a",
    "conflictDetected": true
  },
  "R03-missing-evidence": {
    "asrCents": 120,
    "ttsCents": null,
    "totalCents": null,
    "disposition": "partial",
    "missing": [
      "tts"
    ],
    "sourceIds": [
      "primary-a"
    ]
  },
  "D01-monthly-sales": {
    "rowCount": 4,
    "januaryCents": 15000,
    "februaryCents": 21000,
    "growthPercent": 40
  },
  "D02-quoted-csv": {
    "rowCount": 3,
    "names": [
      "Acme, Inc",
      "A \"quoted\" shop",
      "Two\nlines"
    ],
    "totalCents": 3060
  },
  "D03-exact-money": {
    "lineCents": [
      30,
      3998,
      10001
    ],
    "totalCents": 14029,
    "currency": "CNY"
  },
  "C01-add-deliverable": {
    "januaryCents": 15000,
    "februaryCents": 21000,
    "growthPercent": 40,
    "rowCount": 4,
    "revision": "add-count-v1"
  },
  "C02-replace-scope": {
    "region": "east",
    "januaryCents": 10010,
    "februaryCents": 12020,
    "growthPercent": 20.08,
    "revision": "east-only-v1"
  },
  "F01-lost-artifact": {
    "rowCount": 4,
    "totalCents": 36000
  },
  "F02-transient-read": {
    "receipt": "source-recovered-v1",
    "totalCents": 36000,
    "recovered": true
  }
};
const id = process.argv[2];
assert.ok(Object.hasOwn(expected, id), 'Unknown case');
function regular(path) {
  assert.ok(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), 'Deliverable must be a regular file');
  assert.equal(realpathSync(path), resolve(path), 'Deliverable may not escape through a symlink');
  return readFileSync(path, 'utf8');
}
function verify() {
  const actual = JSON.parse(regular('result.json'));
  if (Array.isArray(actual.sourceIds)) actual.sourceIds.sort();
  if (id === 'R03-missing-evidence') {
    const known = new Set(['primary-a', 'primary-b', 'secondary-note']);
    assert.ok(Array.isArray(actual.sourceIds) && actual.sourceIds.includes('primary-a')
      && actual.sourceIds.every(source => known.has(source)), 'Require vendor A evidence and reject invented sources');
    // This prompt asks for source IDs without restricting the list to direct support.
    // Additional consulted fixture sources are valid; they do not supply a TTS price.
    actual.sourceIds = ['primary-a'];
  }
  assert.deepEqual(actual, expected[id], 'Result must match independently frozen facts');
  const report = regular('report.md');
  assert.ok(report.trim().length >= 80, 'Report must explain the result and limitations');
}
verify();
if (id.startsWith('D')) {
  regular('reproduce.mjs');
  unlinkSync('result.json');
  execFileSync(process.execPath, ['reproduce.mjs'], { timeout: 10000 });
  verify();
  const path = id === 'D01-monthly-sales' ? 'sales.csv' : id === 'D02-quoted-csv' ? 'quoted.csv' : 'invoice.json';
  const original = regular(path);
  try {
    let variant;
    let alternative;
    if (id === 'D01-monthly-sales') {
      variant = original + '2026-02-20,east,90.00\n';
      alternative = { rowCount: 5, januaryCents: 15000, februaryCents: 30000, growthPercent: 100 };
    } else if (id === 'D02-quoted-csv') {
      variant = original.replace('10.10', '11.10').replace('Acme, Inc', 'Other, Ltd');
      alternative = { rowCount: 3, names: ['Other, Ltd', 'A "quoted" shop', 'Two\nlines'], totalCents: 3160 };
    } else {
      variant = JSON.stringify([{ price: '0.10', quantity: 7 }, { price: '19.99', quantity: 2 }, { price: '100.01', quantity: 1 }]);
      alternative = { lineCents: [70, 3998, 10001], totalCents: 14069, currency: 'CNY' };
    }
    writeFileSync(path, variant);
    unlinkSync('result.json');
    execFileSync(process.execPath, ['reproduce.mjs'], { timeout: 10000 });
    assert.deepEqual(JSON.parse(regular('result.json')), alternative, 'Reproduction must derive answers from changed inputs');
  } finally {
    writeFileSync(path, original);
    execFileSync(process.execPath, ['reproduce.mjs'], { timeout: 10000 });
  }
}
if (id === 'C01-add-deliverable') {
  const notes = regular('change_notes.md');
  assert.ok(notes.includes('add-count-v1') && notes.includes('4'), 'Changed requirement must reach the added artifact');
}
if (id === 'F02-transient-read') {
  const attempts = Number(regular('.retry-attempts'));
  assert.ok(Number.isInteger(attempts) && attempts >= 2 && attempts <= 3, 'Transient reader must actually be retried within budget');
}
console.log(JSON.stringify({ caseId: id, passed: true, evidence: 'frozen-state-and-artifact-checks' }));

// End-to-end (Node) pipeline: real sample files -> parse -> validate -> export every format.
// Exports land in test/out/ with a manifest that test/validate_exports.py reads back
// with independent OFX/CSV parsers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as XLSX from 'xlsx';
import { parseDelimited, decodeText } from '../docs/js/core/csv.js';
import { autoDetect, applyMapping } from '../docs/js/core/mapping.js';
import { validateStatement } from '../docs/js/core/validate.js';
import { parsePdfStatement } from '../docs/js/core/pdftext.js';
import { sheetToRows } from '../docs/js/core/sheet.js';
import { exportStatement } from '../docs/js/export/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, 'fixtures');
const OUT = join(here, 'out');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const manifest = [];
const NOW = new Date(Date.UTC(2026, 9, 19, 12, 0, 0));

function exportAll(name, txns, { account, closing, xeroDateFormat = 'MM/DD/YYYY' }) {
  for (const fmt of ['ofx2', 'ofx1', 'qfx', 'qbo', 'xero']) {
    const r = exportStatement(fmt, { txns, account, closing, intuBid: '3000', org: 'Sample', fid: '3000', xeroDateFormat, baseName: name, now: NOW });
    const file = join(OUT, `${name}.${fmt}${fmt === 'xero' ? '.csv' : ''}`);
    writeFileSync(file, r.bytes);
    manifest.push({
      file, format: fmt, count: txns.length,
      sum: txns.reduce((a, t) => a + t.amount, 0),
      closing: closing ?? txns.reduce((a, t) => a + t.amount, 0),
      card: account.type === 'CREDITCARD',
      dates: txns.map((t) => t.date).sort(),
      amounts: txns.map((t) => t.amount),
      xeroDateFormat,
      // the description of a row with non-ASCII text, if any, to check encodings
      sample: (txns.find((t) => /[^\x00-\x7f]/.test(t.description)) || txns[0]).description,
    });
  }
}

const truth = JSON.parse(readFileSync(join(FIX, 'generated/truth.json'), 'utf8'));
const truthOf = (f) => truth.find((t) => t.file === f);

function sameTxns(got, want) {
  assert.equal(got.length, want.length, 'transaction count');
  want.forEach((w, i) => {
    assert.equal(got[i].date, w.date, `date row ${i}`);
    assert.equal(got[i].amount, w.amount, `amount row ${i}`);
    assert.equal(got[i].description, w.description, `description row ${i}`);
    if (w.balance != null) assert.equal(got[i].balance, w.balance, `balance row ${i}`);
  });
}

// ---------------- CSV: csv2ofx public test data (MIT) ----------------
const csvExpect = {
  'capitalone.csv': { preset: 'capitalone-card', count: 2, first: { date: '2015-12-31', amount: -100000 }, card: true },
  'creditunion.csv': { count: 8, first: { date: '2015-02-08', amount: 5000000 } },
  'default.csv': { count: 8, first: { date: '2015-02-08', amount: 5000000 } },
  'ingesp.csv': { count: 10, first: { date: '2022-03-24', amount: 283 }, balanceGaps: true },
  'mint.csv': { preset: 'mint-export', count: 4, first: { date: '2015-06-12', amount: -100000 } },
  'n26-fr.csv': { preset: 'n26', count: 2, first: { date: '2020-03-07', amount: 32800 } },
  'payoneer.csv': { preset: 'payoneer', count: 2, first: { date: '2021-05-03', amount: -10000 }, valid: true },
  'schwab-checking.csv': { preset: 'schwab-checking', count: 4, first: { date: '2022-08-17', amount: 2000 }, valid: true, order: 'descending', checkNum: '558' },
  'ubs-ch-fr_trimmed.csv': { preset: 'ubs-fr', count: 3, first: { date: '2019-03-31', amount: -1000 }, valid: true },
  'xero.csv': { count: 13, first: { date: '2015-01-23', amount: -3600000 } },
};

for (const [file, exp] of Object.entries(csvExpect)) {
  test(`CSV ${file}`, () => {
    const { rows } = parseDelimited(decodeText(readFileSync(join(FIX, 'csv2ofx', file))));
    const det = autoDetect(rows, 'en');
    if (exp.preset) assert.equal(det.preset, exp.preset);
    const { txns, rejected } = applyMapping(det.dataRows, det.mapping, det.options);
    assert.equal(rejected.length, 0, 'no rejected rows');
    assert.equal(txns.length, exp.count);
    assert.equal(txns[0].date, exp.first.date);
    assert.equal(txns[0].amount, exp.first.amount);
    const v = validateStatement(txns);
    if (exp.valid) assert.equal(v.ok, true, JSON.stringify(v.checks));
    if (exp.order) assert.equal(v.order, exp.order);
    if (exp.balanceGaps) assert.equal(v.checks.find((c) => c.id === 'running').ok, false, 'trimmed file must show balance gaps');
    if (exp.checkNum) assert.ok(txns.some((t) => t.checkNum === exp.checkNum));
    exportAll(file.replace(/\.csv$/, ''), txns, {
      account: { type: exp.card ? 'CREDITCARD' : 'CHECKING', id: '12345678', bankId: '121000248', currency: 'USD' },
      closing: v.summary.closing,
    });
  });
}

// ---------------- CSV / XLSX generated (Brazil) ----------------
test('CSV br-extrato.csv (semicolon, decimal comma, accents)', () => {
  const { rows, delimiter } = parseDelimited(decodeText(readFileSync(join(FIX, 'generated/br-extrato.csv'))));
  assert.equal(delimiter, ';');
  const det = autoDetect(rows, 'pt');
  assert.equal(det.options.decimal, 'comma');
  assert.equal(det.options.dateOrder, 'DMY');
  const { txns } = applyMapping(det.dataRows, det.mapping, det.options);
  const t = truthOf('br-extrato.csv');
  sameTxns(txns, t.txns);
  const v = validateStatement(txns);
  assert.equal(v.ok, true);
  assert.equal(v.summary.opening, t.opening);
  assert.equal(v.summary.closing, t.closing);
  exportAll('br-extrato', txns, { account: { type: 'CHECKING', id: '123456', bankId: '0001', currency: 'BRL' }, closing: v.summary.closing, xeroDateFormat: 'DD/MM/YYYY' });
});

test('XLSX pt-extrato.xlsx (date + number cells, title rows above header)', () => {
  const { rows } = sheetToRows(XLSX, new Uint8Array(readFileSync(join(FIX, 'generated/pt-extrato.xlsx'))));
  const det = autoDetect(rows, 'pt');
  assert.equal(det.headerRow, 1);
  const { txns } = applyMapping(det.dataRows, det.mapping, det.options);
  const t = truthOf('pt-extrato.xlsx');
  sameTxns(txns, t.txns);
  const v = validateStatement(txns);
  assert.equal(v.ok, true);
  assert.equal(v.summary.closing, t.closing);
  exportAll('pt-extrato-xlsx', txns, { account: { type: 'SAVINGS', id: '98765', bankId: '0001', currency: 'BRL' }, closing: v.summary.closing, xeroDateFormat: 'DD/MM/YYYY' });
});

// ---------------- PDFs (generated, known truth) ----------------
for (const file of ['en-checking-2page.pdf', 'pt-extrato-saldo.pdf', 'pt-extrato-dc.pdf', 'en-unsigned-balance.pdf']) {
  test(`PDF ${file}`, async () => {
    const t = truthOf(file);
    const res = await parsePdfStatement(pdfjs, new Uint8Array(readFileSync(join(FIX, 'generated', file))), { locale: file.startsWith('pt') ? 'pt' : 'en' });
    sameTxns(res.txns, t.txns);
    assert.equal(res.opening, t.opening, 'opening');
    if (res.closing != null) assert.equal(res.closing, t.closing, 'closing');
    assert.deepEqual(res.unparsed, []);
    const v = validateStatement(res.txns, { opening: res.opening, closing: res.closing });
    assert.equal(v.ok, true, JSON.stringify(v.checks));
    assert.equal(v.summary.closing, t.closing);
    assert.ok(v.checks.find((c) => c.id === 'totals').ok);
    exportAll(file.replace(/\.pdf$/, ''), res.txns, {
      account: { type: 'CHECKING', id: '4321', bankId: file.startsWith('pt') ? '0001' : '011000015', currency: file.startsWith('pt') ? 'BRL' : 'USD' },
      closing: v.summary.closing,
      xeroDateFormat: file.startsWith('pt') ? 'DD/MM/YYYY' : 'MM/DD/YYYY',
    });
  });
}

// ---------------- Third-party PDF (optional, not redistributed) ----------------
const EXT = join(here, 'external/monopoly_example_statement.pdf');
test('PDF monopoly example credit card statement (external, AGPL sample, not bundled)', { skip: !existsSync(EXT) && 'run scripts/fetch-external-samples.sh first' }, async () => {
  const res = await parsePdfStatement(pdfjs, new Uint8Array(readFileSync(EXT)), { locale: 'en' });
  assert.equal(res.txns.length, 52);
  assert.equal(res.opening, 41216); // LAST MONTH'S BALANCE 412.16
  assert.equal(res.closing, 70210); // TOTAL AMOUNT DUE 702.10
  assert.equal(res.txns[0].date, '2023-07-02');
  assert.equal(res.txns[0].amount, -41216); // (412.16) payment
  assert.equal(res.txns.at(-1).amount, -138); // (1.38) cash rebate
  const v = validateStatement(res.txns, { opening: res.opening, closing: res.closing });
  assert.ok(v.checks.find((c) => c.id === 'totals').ok, JSON.stringify(v.checks));
  // Card statement: charges are printed positive. Flip for OFX (charges negative).
  const flipped = res.txns.map((t) => ({ ...t, amount: -t.amount }));
  exportAll('monopoly-card', flipped, { account: { type: 'CREDITCARD', id: '9473', currency: 'SGD' }, closing: -res.closing, xeroDateFormat: 'DD/MM/YYYY' });
});

test.after(() => {
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
});

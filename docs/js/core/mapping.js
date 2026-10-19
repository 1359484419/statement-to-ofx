// Column mapping: find the header row, guess which column holds what, match presets,
// then turn raw rows into normalized transactions.

import { parseAmount, detectDecimal } from './numbers.js';
import { parseDate, detectDateOrder } from './dates.js';

export const ROLES = ['date', 'description', 'memo', 'amount', 'debit', 'credit', 'balance', 'dcFlag', 'checkNum', 'reference'];

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[*_]/g, ' ').replace(/\s+/g, ' ').trim();

// Keyword lists per role. Earlier entries are stronger matches.
const KEYWORDS = {
  date: ['date', 'transaction date', 'trans date', 'booking date', 'posting date', 'data', 'data lancamento', 'data do lancamento', 'data movimento', 'fecha', 'date de valeur', 'datum', 'journaldate', 'posted date', 'value date'],
  description: ['description', 'transaction description', 'desc', 'details', 'narrative', 'payee', 'partner name', 'historico', 'descricao', 'lancamento', 'concepto', 'description 1', 'name', 'merchant', 'memo'],
  memo: ['original description', 'memo', 'notes', 'additional description', 'payment reference', 'description 2', 'description1', 'complemento', 'observacao'],
  amount: ['amount', 'transaction amount', 'valor', 'valor (r$)', 'amount (eur)', 'amount (usd)', 'importe', 'montant', 'betrag', 'netamount', 'net amount', 'value'],
  debit: ['debit', 'debits', 'withdrawal', 'withdrawals', 'debit amount', 'debito', 'debitos', 'saida', 'saidas', 'money out', 'paid out', 'charges', 'charge'],
  credit: ['credit', 'credits', 'deposit', 'deposits', 'credit amount', 'credito', 'creditos', 'entrada', 'entradas', 'money in', 'paid in', 'payments'],
  balance: ['balance', 'running balance', 'runningbalance', 'saldo', 'saldo (r$)', 'solde', 'kontostand', 'available balance'],
  dcFlag: ['transaction type', 'type', 'd/c', 'dc', 'cr/dr', 'dr/cr', 'debit/credit', 'tipo', 'natureza', 'c/d'],
  checkNum: ['check number', 'checknumber', 'check no', 'check #', 'check', 'cheque', 'cheque number', 'num', 'documento', 'n documento', 'no documento', 'doc'],
  reference: ['reference', 'ref', 'transaction id', 'reference id', 'n de transaction', 'referencia', 'id'],
};

function roleScores(header) {
  const h = norm(header).replace(/[º°]/g, '');
  const out = {};
  if (!h) return out;
  for (const role of ROLES) {
    const list = KEYWORDS[role];
    let best = 0;
    list.forEach((k, i) => {
      const strength = 1 - i / (list.length * 2);
      if (h === k) best = Math.max(best, 2 + strength);
      else if (k.length >= 4 && (h.startsWith(k + ' ') || h.endsWith(' ' + k) || h.includes(' ' + k + ' '))) best = Math.max(best, 1 + strength);
    });
    if (best) out[role] = best;
  }
  return out;
}

/** Index of the header row within the first rows, or -1 if the data looks headerless. */
export function findHeaderRow(rows) {
  const limit = Math.min(rows.length, 30);
  for (let i = 0; i < limit; i++) {
    const r = rows[i];
    const hits = r.filter((c) => Object.keys(roleScores(c)).length > 0).length;
    const dateLike = r.filter((c) => parseDate(c, 'MDY', 2000) || parseDate(c, 'DMY', 2000)).length;
    if (hits >= 2 && dateLike === 0) return i;
  }
  return -1;
}

const DC_DEBIT = /^(d|dr|db|debit|debito|withdrawal|saida|out)$/;
const DC_CREDIT = /^(c|cr|credit|credito|deposit|entrada|in)$/;

function columnValues(rows, idx) {
  return rows.map((r) => r[idx]).filter((v) => v != null && String(v).trim() !== '');
}

function rate(values, fn) {
  if (!values.length) return 0;
  return values.filter(fn).length / values.length;
}

/**
 * Guess a mapping { role: columnIndex } from headers (may be null) and data rows.
 */
export function guessMapping(headers, rows, locale = 'en') {
  const ncol = Math.max(headers ? headers.length : 0, ...rows.slice(0, 50).map((r) => r.length));
  const sample = rows.slice(0, 200);
  const mapping = {};
  const used = new Set();
  const isDate = (v) => !!(parseDate(v, 'MDY', 2000) || parseDate(v, 'DMY', 2000));
  const isNum = (v) => parseAmount(v) != null;

  if (headers) {
    const cands = [];
    headers.forEach((h, idx) => {
      const sc = roleScores(h);
      for (const [role, s] of Object.entries(sc)) cands.push({ role, idx, s });
    });
    cands.sort((a, b) => b.s - a.s);
    for (const c of cands) {
      if (mapping[c.role] != null || used.has(c.idx)) continue;
      const vals = columnValues(sample, c.idx);
      // content sanity checks
      if (c.role === 'date' && rate(vals, isDate) < 0.6) continue;
      if (['amount', 'debit', 'credit', 'balance'].includes(c.role) && vals.length && rate(vals, isNum) < 0.6) continue;
      if (c.role === 'dcFlag' && rate(vals, (v) => DC_DEBIT.test(norm(v)) || DC_CREDIT.test(norm(v))) < 0.8) continue;
      if (c.role === 'checkNum' && vals.length && rate(vals, (v) => /^\d{1,10}$/.test(String(v).trim())) < 0.6) continue;
      mapping[c.role] = c.idx; used.add(c.idx);
    }
    // a "posted date" etc. may be the only date column
    if (mapping.date == null) {
      for (let i = 0; i < ncol; i++) {
        if (!used.has(i) && rate(columnValues(sample, i), isDate) > 0.8) { mapping.date = i; used.add(i); break; }
      }
    }
  }

  // Content-based inference for headerless files or missing roles.
  if (mapping.date == null) {
    for (let i = 0; i < ncol; i++) {
      if (used.has(i)) continue;
      if (rate(columnValues(sample, i), isDate) > 0.8) { mapping.date = i; used.add(i); break; }
    }
  }
  if (mapping.amount == null && mapping.debit == null && mapping.credit == null) {
    for (let i = 0; i < ncol; i++) {
      if (used.has(i)) continue;
      const vals = columnValues(sample, i);
      if (vals.length >= sample.length * 0.8 && rate(vals, isNum) > 0.9 && rate(vals, (v) => /[.,]\d{2}\b|^-?\d+$/.test(String(v))) > 0.9) {
        mapping.amount = i; used.add(i); break;
      }
    }
  }
  if (mapping.description == null) {
    let best = -1, bestLen = 0;
    for (let i = 0; i < ncol; i++) {
      if (used.has(i)) continue;
      const vals = columnValues(sample, i);
      if (rate(vals, isNum) > 0.5) continue;
      const avg = vals.reduce((a, v) => a + String(v).length, 0) / (vals.length || 1);
      if (avg > bestLen) { bestLen = avg; best = i; }
    }
    if (best >= 0) { mapping.description = best; used.add(best); }
  }
  // headerless D/C flag column
  if (mapping.dcFlag == null && mapping.amount != null) {
    for (let i = 0; i < ncol; i++) {
      if (used.has(i)) continue;
      const vals = columnValues(sample, i);
      if (vals.length && rate(vals, (v) => DC_DEBIT.test(norm(v)) || DC_CREDIT.test(norm(v))) > 0.9) { mapping.dcFlag = i; used.add(i); break; }
    }
  }
  // A dcFlag only makes sense with unsigned amounts.
  if (mapping.dcFlag != null) {
    const amts = columnValues(sample, mapping.amount ?? -1).map((v) => parseAmount(v)).filter(Boolean);
    if (mapping.amount == null || amts.some((a) => a.cents < 0)) delete mapping.dcFlag;
  }
  return mapping;
}

/** Suggest options (date order, decimal separator) from the mapped columns. */
export function guessOptions(rows, mapping, locale = 'en') {
  const dateVals = mapping.date != null ? columnValues(rows, mapping.date).slice(0, 300) : [];
  const moneyVals = ['amount', 'debit', 'credit', 'balance']
    .filter((r) => mapping[r] != null)
    .flatMap((r) => columnValues(rows, mapping[r]).slice(0, 300));
  return {
    dateOrder: detectDateOrder(dateVals, locale === 'pt' ? 'DMY' : 'MDY'),
    decimal: detectDecimal(moneyVals, locale === 'pt' ? 'comma' : 'dot'),
    invert: false,
  };
}

/**
 * Convert rows to transactions.
 * Returns { txns: [{date, description, memo, amount, balance, checkNum, reference, src}], rejected: [{row, reason}] }
 */
export function applyMapping(rows, mapping, opts) {
  const { dateOrder = 'MDY', decimal = 'auto', invert = false } = opts || {};
  const txns = [], rejected = [];
  const cell = (r, role) => (mapping[role] != null ? r[mapping[role]] : undefined);
  rows.forEach((r, i) => {
    const rawDate = cell(r, 'date');
    const date = parseDate(rawDate, dateOrder);
    if (!date) { rejected.push({ row: i, reason: 'date', raw: r }); return; }
    let amount = null;
    if (mapping.debit != null || mapping.credit != null) {
      const d = parseAmount(cell(r, 'debit'), decimal);
      const c = parseAmount(cell(r, 'credit'), decimal);
      if (d || c) amount = (c ? Math.abs(c.cents) : 0) - (d ? Math.abs(d.cents) : 0);
      // some files put the signed amount in "debit"/"credit" with one empty column
      if (mapping.amount != null && amount == null) {
        const a = parseAmount(cell(r, 'amount'), decimal);
        if (a) amount = a.cents;
      }
    } else {
      const a = parseAmount(cell(r, 'amount'), decimal);
      if (a) {
        amount = a.cents;
        let flag = a.dc;
        if (mapping.dcFlag != null) {
          const f = norm(cell(r, 'dcFlag'));
          if (DC_DEBIT.test(f)) flag = 'D'; else if (DC_CREDIT.test(f)) flag = 'C';
        }
        if (flag === 'D') amount = -Math.abs(amount);
        else if (flag === 'C') amount = Math.abs(amount);
      }
    }
    if (amount == null) { rejected.push({ row: i, reason: 'amount', raw: r }); return; }
    if (invert) amount = -amount;
    const bal = parseAmount(cell(r, 'balance'), decimal);
    const desc = [cell(r, 'description')].filter(Boolean).join(' ').trim();
    txns.push({
      date,
      description: desc || String(cell(r, 'memo') || '').trim(),
      memo: String(cell(r, 'memo') || '').trim(),
      amount,
      balance: bal ? bal.cents : null,
      checkNum: String(cell(r, 'checkNum') || '').trim(),
      reference: String(cell(r, 'reference') || '').trim(),
      src: i,
    });
  });
  return { txns, rejected };
}

/** Find the most likely mapping for a 2D array of cells. */
export function autoDetect(allRows, locale = 'en') {
  const headerRow = findHeaderRow(allRows);
  const headers = headerRow >= 0 ? allRows[headerRow] : null;
  const dataRows = allRows.slice(headerRow + 1);
  const preset = matchPreset(headers);
  const mapping = preset ? presetMapping(preset, headers) : guessMapping(headers, dataRows, locale);
  const options = { ...guessOptions(dataRows, mapping, locale), ...(preset?.options || {}) };
  return { headerRow, headers, dataRows, mapping, options, preset: preset ? preset.id : null };
}

// ---- Presets ---------------------------------------------------------------
// Each preset is verified against a public sample file in test/fixtures.
// Banks change their exports, so presets are a starting point, not a promise.
export const PRESETS = [
  {
    id: 'capitalone-card', name: 'Capital One card CSV layout',
    headers: ['transaction date', 'posted date', 'card no.', 'description', 'category', 'debit', 'credit'],
    map: { date: 'transaction date', description: 'description', debit: 'debit', credit: 'credit' },
    options: { dateOrder: 'YMD', decimal: 'dot' },
  },
  {
    id: 'schwab-checking', name: 'Schwab checking CSV layout',
    headers: ['date', 'status', 'type', 'checknumber', 'description', 'withdrawal', 'deposit', 'runningbalance'],
    map: { date: 'date', description: 'description', debit: 'withdrawal', credit: 'deposit', balance: 'runningbalance', checkNum: 'checknumber' },
    options: { dateOrder: 'MDY', decimal: 'dot' },
  },
  {
    id: 'mint-export', name: 'Mint export CSV layout',
    headers: ['date', 'description', 'original description', 'amount', 'transaction type', 'category', 'account name'],
    map: { date: 'date', description: 'description', memo: 'original description', amount: 'amount', dcFlag: 'transaction type' },
    options: { dateOrder: 'MDY', decimal: 'dot' },
  },
  {
    id: 'payoneer', name: 'Payoneer CSV layout',
    headers: ['transaction date', 'description', 'credit amount', 'debit amount', 'running balance', 'transaction id'],
    map: { date: 'transaction date', description: 'description', credit: 'credit amount', debit: 'debit amount', balance: 'running balance', reference: 'transaction id', memo: 'additional description' },
    options: { dateOrder: 'MDY', decimal: 'dot' },
  },
  {
    id: 'n26', name: 'N26 CSV layout',
    headers: ['booking date', 'partner name', 'payment reference', 'amount (eur)'],
    map: { date: 'booking date', description: 'partner name', memo: 'payment reference', amount: 'amount (eur)' },
    options: { dateOrder: 'YMD', decimal: 'dot' },
  },
  {
    id: 'ubs-fr', name: 'UBS (French) CSV layout',
    headers: ['produit', 'monn.', 'date de valeur', 'description 1', 'debit', 'credit', 'solde'],
    map: { date: 'date de valeur', description: 'description 2', memo: 'description 1', debit: 'debit', credit: 'credit', balance: 'solde', reference: 'n de transaction' },
    options: { dateOrder: 'DMY', decimal: 'dot' },
  },
];

function matchPreset(headers) {
  if (!headers) return null;
  const hs = headers.map((h) => norm(h).replace(/[º°]/g, ''));
  return PRESETS.find((p) => p.headers.every((h) => hs.includes(h))) || null;
}

function presetMapping(preset, headers) {
  const hs = headers.map((h) => norm(h).replace(/[º°]/g, ''));
  const m = {};
  for (const [role, h] of Object.entries(preset.map)) {
    const i = hs.indexOf(h);
    if (i >= 0) m[role] = i;
  }
  return m;
}

export function presetById(id) { return PRESETS.find((p) => p.id === id) || null; }
export function mappingForPreset(id, headers) {
  const p = presetById(id);
  return p && headers ? presetMapping(p, headers) : null;
}

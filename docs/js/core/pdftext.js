// Text-layer PDF statements: pull positioned text with pdf.js, rebuild lines,
// then find transaction rows with a layout-agnostic heuristic.
// This only works for PDFs that contain real text (not scans).

import { parseAmount, looksLikeMoney } from './numbers.js';
import { parseDate, lacksYear, LEADING_DATE_RE, detectDateOrder } from './dates.js';
import { inferSignsFromBalance } from './validate.js';

/**
 * Extract positioned text with a pdf.js module (browser or Node build).
 * @returns pages: [{ width, height, items: [{str, x, y, w, h}] }]
 */
export async function extractPdfItems(pdfjs, data, { password } = {}) {
  const task = pdfjs.getDocument({ data, password, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const [a, b, c, d, e, f] = it.transform;
      const h = Math.hypot(c, d) || it.height || 10;
      items.push({ str: it.str, x: e, y: vp.height - f, w: it.width, h });
    }
    pages.push({ width: vp.width, height: vp.height, items });
  }
  await doc.destroy();
  return pages;
}

/** Group items into lines, and items within a line into cells separated by visible gaps. */
export function buildLines(pages) {
  const lines = [];
  pages.forEach((pg, pi) => {
    const items = [...pg.items].sort((a, b) => a.y - b.y || a.x - b.x);
    let cur = null;
    for (const it of items) {
      const tol = Math.max(2, it.h * 0.45);
      if (cur && Math.abs(it.y - cur.y) <= tol) cur.items.push(it);
      else { cur = { page: pi, y: it.y, h: it.h, items: [it] }; lines.push(cur); }
    }
  });
  for (const ln of lines) {
    ln.items.sort((a, b) => a.x - b.x);
    const cells = [];
    for (const it of ln.items) {
      const last = cells[cells.length - 1];
      const gap = last ? it.x - (last.x + last.w) : Infinity;
      const space = it.h * 0.25;
      if (last && gap < it.h * 0.9) {
        last.str += (gap > space && !last.str.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str;
        last.w = it.x + it.w - last.x;
      } else cells.push({ str: it.str, x: it.x, w: it.w });
    }
    cells.forEach((c) => { c.str = c.str.replace(/\s+/g, ' ').trim(); c.r = c.x + c.w; });
    ln.cells = cells.filter((c) => c.str);
    ln.text = ln.cells.map((c) => c.str).join(' ');
  }
  return lines;
}

const HEADER_WORDS = {
  date: /^(date|data|dt\.?|trans(action)? date|posting date|data mov(imento)?\.?)$/i,
  description: /^(description|transaction details|details|historico|histórico|descri[cç][aã]o|lan[cç]amento|transaction)$/i,
  debit: /^(debits?|withdrawals?( and other debits)?|d[eé]bitos?|sa[ií]das?|money out|charges)(\s*\(.*\))?$/i,
  credit: /^(credits?|deposits?( and other credits)?|cr[eé]ditos?|entradas?|money in|payments)(\s*\(.*\))?$/i,
  amount: /^(amount|valor|value)(\s*\(.*\))?$/i,
  balance: /^(balance|running balance|saldo)(\s*\(.*\))?$/i,
  doc: /^(documento|doc\.?|check ?(no|#)?\.?|ref(erence)?\.?|n[ºo°]? ?doc\.?)$/i,
};

const OPENING_RE = /\b(beginning|opening|previous|starting|start|last month'?s|last statement) balance\b|saldo anterior|saldo inicial/i;
const CLOSING_RE = /\b(ending|closing|new|final|statement) balance\b|\btotal amount due\b|saldo final|saldo atual(?! dispon)/i;
const SKIP_DESC_RE = /^saldo (do dia|anterior|final|em c\/c|dispon[ií]vel)|^(daily )?balance$|^total\b|^subtotal\b|^totals?\b/i;
const NOISE_RE = /^(page|p[aá]gina|pag\.)\s*\d+(\s*(of|de|\/)\s*\d+)?$|^continued|^continua/i;

function headerRoles(line) {
  const roles = {};
  for (const c of line.cells) {
    for (const [role, re] of Object.entries(HEADER_WORDS)) {
      if (re.test(c.str) && !roles[role]) roles[role] = { x: c.x, r: c.r, c: c.x + c.w / 2 };
    }
  }
  const n = Object.keys(roles).length;
  return n >= 3 && roles.date && (roles.amount || roles.debit || roles.credit) ? roles : null;
}

function nearestRole(cell, cols) {
  // amounts are usually right-aligned under their header: compare right edges, then centers
  let best = null, bestD = Infinity;
  for (const role of ['debit', 'credit', 'amount', 'balance']) {
    const h = cols[role];
    if (!h) continue;
    const d = Math.min(Math.abs(cell.r - h.r), Math.abs((cell.x + cell.r) / 2 - h.c));
    if (d < bestD) { bestD = d; best = role; }
  }
  return best;
}

function findYearHint(lines) {
  const years = {};
  for (const ln of lines) {
    const ms = ln.text.match(/\b(19|20)\d{2}\b/g);
    if (ms) ms.forEach((y) => { years[y] = (years[y] || 0) + 1; });
  }
  // Statement period lines are the strongest hint: take the earliest year printed on one.
  const period = lines.find((ln) => /statement period|period|per[ií]odo|from .* to|de .* a /i.test(ln.text) && /\b(19|20)\d{2}\b/.test(ln.text));
  if (period) {
    const ys = period.text.match(/\b(19|20)\d{2}\b/g).map(Number).sort();
    return ys[0];
  }
  const ranked = Object.entries(years).sort((a, b) => b[1] - a[1]);
  return ranked.length ? Number(ranked[0][0]) : null;
}

/**
 * Turn PDF lines into transactions.
 * @param lines from buildLines
 * @param opts { locale: 'en'|'pt', dateOrder?: 'MDY'|'DMY', year?: number, decimal?: 'dot'|'comma'|'auto' }
 */
export function parseStatementLines(lines, opts = {}) {
  const locale = opts.locale || 'en';
  const warnings = [];
  let cols = null;
  let opening = null, closing = null;
  const rows = [];
  const unparsed = [];

  // Pass 1: collect date-led lines to settle the date order and decimal separator.
  const dateTokens = [], moneyTokens = [];
  for (const ln of lines) {
    const m = ln.text.match(LEADING_DATE_RE);
    if (m) dateTokens.push(m[1]);
    ln.cells.forEach((c) => { if (looksLikeMoney(c.str)) moneyTokens.push(c.str); });
  }
  const dateOrder = opts.dateOrder || detectDateOrder(dateTokens, locale === 'pt' ? 'DMY' : 'MDY');
  let decimal = opts.decimal || 'auto';
  if (decimal === 'auto') {
    let comma = 0, dot = 0;
    moneyTokens.forEach((t) => { if (/,\d{2}\b/.test(t)) comma++; else if (/\.\d{2}\b/.test(t)) dot++; });
    decimal = comma > dot ? 'comma' : 'dot';
  }
  let year = opts.year || findYearHint(lines) || new Date().getFullYear();

  let last = null;
  let lastMonth = null;
  for (const ln of lines) {
    if (NOISE_RE.test(ln.text)) continue;
    const hr = headerRoles(ln);
    if (hr) { cols = hr; last = null; continue; }

    const moneyCells = ln.cells.filter((c) => looksLikeMoney(c.str));
    if (OPENING_RE.test(ln.text) && moneyCells.length) {
      const a = parseAmount(moneyCells[moneyCells.length - 1].str, decimal);
      if (a && opening == null) opening = a.dc === 'D' ? -Math.abs(a.cents) : a.cents;
      last = null; continue;
    }
    if (CLOSING_RE.test(ln.text) && moneyCells.length) {
      const a = parseAmount(moneyCells[moneyCells.length - 1].str, decimal);
      if (a) closing = a.dc === 'D' ? -Math.abs(a.cents) : a.cents;
      last = null; continue;
    }

    const dm = ln.text.match(LEADING_DATE_RE);
    if (dm && moneyCells.length) {
      const rawDate = dm[1];
      let y = year;
      let date = parseDate(rawDate, dateOrder, y);
      if (date && lacksYear(rawDate)) {
        const month = Number(date.slice(5, 7));
        if (lastMonth != null && month < lastMonth && lastMonth - month > 6) { year++; date = parseDate(rawDate, dateOrder, year); }
        lastMonth = Number(date.slice(5, 7));
      }
      if (!date) { unparsed.push(ln.text); continue; }
      // Description: text cells that are neither the date nor money, left of the first amount.
      const firstMoneyX = moneyCells[0].x;
      const textParts = [];
      let docNo = '';
      for (const c of ln.cells) {
        if (moneyCells.includes(c)) continue;
        let s = c.str;
        if (c.x >= firstMoneyX) continue;
        if (textParts.length === 0 && s.startsWith(rawDate)) s = s.slice(rawDate.length).trim();
        if (!s) continue;
        if (cols && cols.doc && Math.abs(c.x - cols.doc.x) < 25 && /^[\w.\-\/]{1,20}$/.test(s)) { docNo = s; continue; }
        textParts.push(s);
      }
      const description = textParts.join(' ').replace(/\s+/g, ' ').trim();
      if (SKIP_DESC_RE.test(description)) {
        const a = parseAmount(moneyCells[moneyCells.length - 1].str, decimal);
        const v = a ? (a.dc === 'D' ? -Math.abs(a.cents) : a.cents) : null;
        if (/saldo anterior/i.test(description) && opening == null) opening = v;
        else if (/saldo do dia|daily balance|^balance$/i.test(description) && rows.length && v != null) {
          const prev = rows[rows.length - 1];
          if (prev.balance == null && prev.date <= date) prev.balance = v;
        }
        last = null; continue;
      }
      // Assign amounts to columns
      const vals = {};
      if (cols) {
        for (const c of moneyCells) {
          const role = nearestRole(c, cols);
          if (role && vals[role] == null) vals[role] = c.str;
        }
      } else if (moneyCells.length >= 2) {
        vals.amount = moneyCells[moneyCells.length - 2].str;
        vals.balance = moneyCells[moneyCells.length - 1].str;
      } else vals.amount = moneyCells[0].str;

      let amount = null, explicit = false;
      if (vals.debit != null || vals.credit != null) {
        const d = vals.debit != null ? parseAmount(vals.debit, decimal) : null;
        const c = vals.credit != null ? parseAmount(vals.credit, decimal) : null;
        amount = (c ? Math.abs(c.cents) : 0) - (d ? Math.abs(d.cents) : 0);
        explicit = true;
      } else if (vals.amount != null) {
        const a = parseAmount(vals.amount, decimal);
        if (a) {
          amount = a.cents;
          if (a.dc === 'D') amount = -Math.abs(amount);
          if (a.dc) explicit = true;
          if (/^[-−(]|[-)]\s*(?:[DC]R?)?$/.test(vals.amount.trim())) explicit = true;
        }
      }
      if (amount == null) { unparsed.push(ln.text); continue; }
      const bal = vals.balance != null ? parseAmount(vals.balance, decimal) : null;
      const balCents = bal ? (bal.dc === 'D' ? -Math.abs(bal.cents) : bal.cents) : null;
      last = { date, description, memo: '', amount, balance: balCents, checkNum: /^\d+$/.test(docNo) ? docNo : '', reference: docNo, explicit, y: ln.y, page: ln.page };
      rows.push(last);
      continue;
    }
    // Continuation of a multi-line description
    if (last && !moneyCells.length && !dm && ln.page === last.page && ln.y - last.y < ln.h * 2.6) {
      const x0 = ln.cells[0].x;
      if (!cols || !cols.description || x0 >= cols.description.x - 10) {
        last.description = (last.description + ' ' + ln.text).trim();
        last.y = ln.y;
        continue;
      }
    }
    if (dm || moneyCells.length) unparsed.push(ln.text);
    last = null;
  }

  // Unsigned single-amount layouts: recover signs from the running balance.
  let signSource = 'columns';
  const anyExplicit = rows.some((r) => r.explicit);
  const hasDebitCredit = cols && (cols.debit || cols.credit);
  if (!hasDebitCredit && !anyExplicit) {
    if (rows.some((r) => r.balance != null)) {
      inferSignsFromBalance(rows, opening);
      signSource = 'balance';
    } else {
      signSource = 'unsigned';
      warnings.push('unsigned');
    }
  } else if (!hasDebitCredit) signSource = 'markers';
  rows.forEach((r) => { delete r.explicit; delete r.y; delete r.page; });
  if (!rows.length) warnings.push('no-rows');
  return { txns: rows, opening, closing, dateOrder, decimal, year, columns: cols ? Object.keys(cols) : null, signSource, unparsed, warnings };
}

/** Convenience: pdf.js module + bytes -> parsed statement. */
export async function parsePdfStatement(pdfjs, data, opts = {}) {
  const pages = await extractPdfItems(pdfjs, data, opts);
  const textItems = pages.reduce((a, p) => a + p.items.length, 0);
  if (!textItems) return { txns: [], opening: null, closing: null, warnings: ['no-text'], unparsed: [], pages: pages.length };
  const lines = buildLines(pages);
  const res = parseStatementLines(lines, opts);
  res.pages = pages.length;
  return res;
}

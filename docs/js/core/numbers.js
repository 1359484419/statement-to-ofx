// Money parsing. All amounts are kept as integer cents to avoid float drift.

const CURRENCY_RE = /(R\$|US\$|C\$|A\$|CHF|USD|BRL|EUR|GBP|CAD|AUD|[$€£¥])/gi;

/**
 * Guess the decimal separator used by a column of raw strings.
 * Returns 'dot' | 'comma'.
 */
export function detectDecimal(samples, fallback = 'dot') {
  let dot = 0, comma = 0;
  for (const raw of samples) {
    if (raw == null || typeof raw === 'number') continue;
    const s = String(raw).replace(CURRENCY_RE, '').replace(/[\s ']/g, '');
    const m = s.match(/[.,](\d+)\D*$/);
    if (!m) continue;
    const sep = s[m.index];
    const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
      if (lastComma > lastDot) comma += 3; else dot += 3;
      continue;
    }
    if (m[1].length === 3) continue; // "1,234" or "1.234": ambiguous
    if (sep === ',') comma++; else dot++;
  }
  if (comma > dot) return 'comma';
  if (dot > comma) return 'dot';
  return fallback;
}

/**
 * Parse a money string into { cents, dc } or null.
 * dc is 'D' | 'C' | null when the value itself carries a debit/credit marker.
 * Handles: "$1,234.56", "(12.00)", "12.00-", "-R$ 1.234,56", "1.234,56 D", "11'373.94", "CR 5.00".
 */
export function parseAmount(raw, decimal = 'auto') {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    if (!isFinite(raw)) return null;
    return { cents: Math.round(raw * 100), dc: null };
  }
  let s = String(raw).trim();
  if (!s) return null;
  let neg = false;
  let dc = null;
  const dcm = s.match(/^(.*?\d.*?)\s*(?<![A-Za-z])(DR|CR|D|C)\.?$/i) || s.match(/^(DR|CR|D|C)(?![A-Za-z])\s*(.*)$/i);
  if (dcm) {
    const [flag, rest] = /^(DR|CR|D|C)$/i.test(dcm[1]) ? [dcm[1], dcm[2]] : [dcm[2], dcm[1]];
    dc = flag.toUpperCase().startsWith('D') ? 'D' : 'C';
    s = rest.trim();
  }
  s = s.replace(CURRENCY_RE, '').replace(/[\s '’]/g, '');
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith('-') || s.startsWith('−')) { neg = !neg; s = s.slice(1); }
  else if (s.startsWith('+')) s = s.slice(1);
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
  else if (s.endsWith('+')) s = s.slice(0, -1);
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); } // "R$-12,00" after currency strip
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  let sep = decimal;
  if (sep === 'auto') {
    const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) sep = lastComma > lastDot ? 'comma' : 'dot';
    else if (lastComma >= 0) sep = /,\d{1,2}$/.test(s) && (s.match(/,/g).length === 1) ? 'comma' : 'dot';
    else sep = 'dot';
  }
  let intPart, frac = '';
  if (sep === 'comma') {
    const parts = s.replace(/\./g, '').split(',');
    if (parts.length > 2) return null;
    [intPart, frac = ''] = parts;
  } else {
    const parts = s.replace(/,/g, '').split('.');
    if (parts.length > 2) {
      // "1.234.567" with dot setting: treat dots as thousands
      intPart = parts.join(''); frac = '';
    } else {
      [intPart, frac = ''] = parts;
    }
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) return null;
  let cents = Number(intPart || '0') * 100;
  if (frac.length <= 2) cents += Number((frac + '00').slice(0, 2));
  else cents += Math.round(Number('0.' + frac) * 100);
  if (neg) cents = -cents;
  return { cents, dc };
}

/** True if the string looks like a money amount with explicit decimals (used for PDF token detection). */
export function looksLikeMoney(str) {
  const s = String(str).trim();
  return /^(?:[-−+(]\s*)?(?:R\$|US\$|\$|€|£)?\s*[-−]?\s*\d{1,3}(?:[.,'  ]?\d{3})*[.,]\d{2}\s*\)?\s*[-+]?\s*(?:DR|CR|D|C)?$/i.test(s);
}

export function formatCents(cents, decimal = 'dot', thousands = true) {
  if (cents == null || isNaN(cents)) return '';
  const neg = cents < 0;
  const abs = Math.abs(cents);
  let int = String(Math.floor(abs / 100));
  const frac = String(abs % 100).padStart(2, '0');
  if (thousands) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, decimal === 'comma' ? '.' : ',');
  return (neg ? '-' : '') + int + (decimal === 'comma' ? ',' : '.') + frac;
}

/** Plain machine format: -1234.56 */
export function centsToPlain(cents) {
  return formatCents(cents, 'dot', false);
}

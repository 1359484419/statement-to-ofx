// Date parsing to ISO 'YYYY-MM-DD'. Supports numeric orders (MDY/DMY/YMD),
// English and Portuguese month names, Excel serials and JS Date objects.

const MONTHS = {
  jan: 1, january: 1, janeiro: 1,
  feb: 2, february: 2, fev: 2, fevereiro: 2,
  mar: 3, march: 3, marco: 3,
  apr: 4, april: 4, abr: 4, abril: 4,
  may: 5, mai: 5, maio: 5,
  jun: 6, june: 6, junho: 6,
  jul: 7, july: 7, julho: 7,
  aug: 8, august: 8, ago: 8, agosto: 8,
  sep: 9, sept: 9, september: 9, set: 9, setembro: 9,
  oct: 10, october: 10, out: 10, outubro: 10,
  nov: 11, november: 11, novembro: 11,
  dec: 12, december: 12, dez: 12, dezembro: 12,
};

const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

function monthFromName(name) {
  const k = stripAccents(String(name).toLowerCase()).replace(/\.$/, '');
  return MONTHS[k] || null;
}

function pad(n) { return String(n).padStart(2, '0'); }

function valid(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2200)) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function fixYear(y) {
  if (y == null) return null;
  y = Number(y);
  if (y < 100) y += y < 70 ? 2000 : 1900;
  return y;
}

function iso(y, m, d) {
  return valid(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
}

const NUMERIC_RE = /^(\d{1,4})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?(?:[ T]\d{1,2}:\d{2}(?::\d{2})?.*)?$/;
const NAME_DMY_RE = /^(\d{1,2})[\s\-\/.]*([A-Za-zÀ-ÿ]{3,10})\.?[\s\-\/.,]*(\d{2,4})?$/;
const NAME_MDY_RE = /^([A-Za-zÀ-ÿ]{3,10})\.?[\s\-\/.]*(\d{1,2})(?:[,\s\-\/.]+(\d{2,4}))?$/;

/**
 * Inspect raw date strings and decide 'MDY' | 'DMY' | 'YMD'.
 */
export function detectDateOrder(samples, fallback = 'MDY') {
  let mdy = 0, dmy = 0, ymd = 0;
  for (const raw of samples) {
    if (raw == null || typeof raw !== 'string') continue;
    const m = raw.trim().match(NUMERIC_RE);
    if (!m) continue;
    if (m[1].length === 4) { ymd++; continue; }
    const a = Number(m[1]), b = Number(m[2]);
    if (a > 12 && b <= 12) dmy++;
    else if (b > 12 && a <= 12) mdy++;
  }
  if (ymd && !mdy && !dmy) return 'YMD';
  if (dmy > mdy) return 'DMY';
  if (mdy > dmy) return 'MDY';
  if (/\./.test(samples.find((s) => typeof s === 'string' && NUMERIC_RE.test(s.trim())) || '')) return 'DMY';
  return fallback;
}

/**
 * Parse a date. order: 'MDY'|'DMY'|'YMD'. defaultYear used when the year is missing.
 * Returns 'YYYY-MM-DD' or null.
 */
export function parseDate(raw, order = 'MDY', defaultYear = null) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date && !isNaN(raw)) {
    return iso(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
  }
  if (typeof raw === 'number') {
    // Excel serial date (1900 system)
    if (raw > 20000 && raw < 80000) {
      const ms = Math.round((raw - 25569) * 86400000);
      const d = new Date(ms);
      return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return null;
  }
  const s = String(raw).trim();
  let m = s.match(NUMERIC_RE);
  if (m) {
    const [_, a, b, c] = m;
    if (a.length === 4) return iso(Number(a), Number(b), Number(c));
    if (/^\d{8}$/.test(s)) return null;
    const year = c != null ? fixYear(c) : defaultYear;
    if (year == null) return null;
    if (order === 'DMY') return iso(year, Number(b), Number(a));
    if (order === 'YMD' && c != null) return iso(fixYear(a), Number(b), Number(c));
    return iso(year, Number(a), Number(b));
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(NAME_DMY_RE);
  if (m && monthFromName(m[2])) {
    const y = m[3] ? fixYear(m[3]) : defaultYear;
    return y == null ? null : iso(y, monthFromName(m[2]), Number(m[1]));
  }
  m = s.match(NAME_MDY_RE);
  if (m && monthFromName(m[1])) {
    const y = m[3] ? fixYear(m[3]) : defaultYear;
    return y == null ? null : iso(y, monthFromName(m[1]), Number(m[2]));
  }
  return null;
}

/** Does the date string omit the year? (e.g. "12/03", "Dec 3") */
export function lacksYear(raw) {
  if (typeof raw !== 'string') return false;
  const s = raw.trim();
  let m = s.match(NUMERIC_RE);
  if (m) return m[3] == null && m[1].length <= 2;
  m = s.match(NAME_DMY_RE);
  if (m && monthFromName(m[2])) return !m[3];
  m = s.match(NAME_MDY_RE);
  if (m && monthFromName(m[1])) return !m[3];
  return false;
}

/** Regex (source) that matches a date token at the start of a text line. */
export const LEADING_DATE_RE = /^(\d{1,2}[\/.\-]\d{1,2}(?:[\/.\-]\d{2,4})?|\d{4}-\d{2}-\d{2}|\d{1,2}[\s\-]?(?:jan|feb|fev|mar|apr|abr|may|mai|jun|jul|aug|ago|sep|set|oct|out|nov|dec|dez)[a-z]*\.?(?:[\s\-]?\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s\d{1,2}(?:,?\s\d{4})?)(?=\s|$)/i;

export function todayISO() {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

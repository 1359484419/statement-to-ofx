// Minimal RFC 4180 style parser that tolerates CR, LF and CRLF line endings,
// a UTF-8 BOM, and auto-detects the delimiter.

const CANDIDATES = [',', ';', '\t', '|'];

function splitRecords(text, delim) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field.trim() === '') { inQ = true; field = ''; continue; }
    if (ch === delim) { row.push(field); field = ''; continue; }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
      continue;
    }
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function detectDelimiter(text) {
  const head = text.slice(0, 20000);
  let best = ',', bestScore = -1;
  for (const d of CANDIDATES) {
    const rows = splitRecords(head, d).filter((r) => r.some((c) => c.trim() !== '')).slice(0, 30);
    if (!rows.length) continue;
    const counts = rows.map((r) => r.length);
    const freq = {};
    counts.forEach((c) => { freq[c] = (freq[c] || 0) + 1; });
    const [mode, n] = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
    if (Number(mode) < 2) continue;
    const score = n * 10 + Number(mode);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/** Returns { delimiter, rows: string[][] } with blank rows removed and cells trimmed. */
export function parseDelimited(text, delimiter = null) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const d = delimiter || detectDelimiter(text);
  const rows = splitRecords(text, d)
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ''));
  return { delimiter: d, rows };
}

/** Decode bytes: UTF-8 when valid, otherwise windows-1252 (common for older bank exports). */
export function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

// Xero bank statement CSV (the simple statement template: Date, Amount, Payee,
// Description, Reference, Check Number). Xero reads the date in the organisation's
// region format, so the caller chooses the date format.

import { centsToPlain } from '../core/numbers.js';

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function formatDate(iso, fmt) {
  const [y, m, d] = iso.split('-');
  if (fmt === 'DD/MM/YYYY') return `${d}/${m}/${y}`;
  if (fmt === 'YYYY-MM-DD') return iso;
  return `${m}/${d}/${y}`;
}

export function buildXeroCsv(txns, { dateFormat = 'MM/DD/YYYY' } = {}) {
  const head = ['*Date', '*Amount', 'Payee', 'Description', 'Reference', 'Check Number'];
  const lines = [head.join(',')];
  for (const t of txns) {
    lines.push([
      formatDate(t.date, dateFormat),
      centsToPlain(t.amount),
      (t.description || '').slice(0, 255),
      t.memo || '',
      t.reference || '',
      t.checkNum || '',
    ].map(csvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

// One entry point for every output format, shared by the page and the tests.
import { buildOfx, encodeOfx, FORMAT_INFO } from './ofx.js';
import { buildXeroCsv } from './xero.js';

export const FORMATS = {
  ...FORMAT_INFO,
  xero: { ext: 'csv', mime: 'text/csv', label: 'Xero bank statement CSV' },
};

/**
 * @param format 'ofx2'|'ofx1'|'qfx'|'qbo'|'xero'
 * @param s { txns, account:{type,id,bankId,currency}, closing, intuBid, org, fid, xeroDateFormat, baseName, now }
 * @returns { bytes: Uint8Array, text: string, filename, mime }
 */
export function exportStatement(format, s) {
  const info = FORMATS[format];
  if (!info) throw new Error('Unknown format ' + format);
  const txns = (s.txns || []).filter((t) => t.date && Number.isFinite(t.amount));
  if (!txns.length) throw new Error('No transactions to export');
  let text, bytes;
  if (format === 'xero') {
    text = buildXeroCsv(txns, { dateFormat: s.xeroDateFormat });
    bytes = new TextEncoder().encode(text);
  } else {
    text = buildOfx({ ...s, txns, format });
    bytes = encodeOfx(text, format);
  }
  const base = (s.baseName || 'statement').replace(/[^\w.\-]+/g, '_').replace(/\.[^.]+$/, '');
  const suffix = format === 'ofx1' ? '-ofx1' : format === 'xero' ? '-xero' : '';
  return { bytes, text, filename: `${base}${suffix}.${info.ext}`, mime: info.mime };
}

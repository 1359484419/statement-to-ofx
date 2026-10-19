// Writers for OFX 1.0.2 (SGML), OFX 2.2 (XML), QFX (Quicken Web Connect) and QBO
// (QuickBooks Web Connect). QFX/QBO are OFX 1.0.2 plus an <INTU.BID> element.

import { centsToPlain } from '../core/numbers.js';

/** Stable 64-bit FNV-1a hash as 16 hex chars. */
export function fnv1a64(str) {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const bytes = new TextEncoder().encode(str);
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

/**
 * FITIDs derived from date, amount, normalized description and the occurrence count of
 * identical rows, so re-exporting the same statement yields the same IDs (no duplicates
 * on re-import), while two identical coffees on one day still get distinct IDs.
 */
export function assignFitids(txns, accountKey = '') {
  const counts = new Map();
  return txns.map((t) => {
    const base = `${accountKey}|${t.date}|${t.amount}|${String(t.description || '').toLowerCase().replace(/\s+/g, ' ').trim()}`;
    const n = (counts.get(base) || 0) + 1;
    counts.set(base, n);
    return fnv1a64(`${base}|${n}`);
  });
}

function ofxDate(iso) { return iso.replace(/-/g, ''); }

function nowStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\r\n\t]+/g, ' ').trim();
}

const ACCT_TYPES = ['CHECKING', 'SAVINGS', 'MONEYMRKT', 'CREDITLINE'];

/**
 * @param {object} p
 *  p.format: 'ofx2' | 'ofx1' | 'qfx' | 'qbo'
 *  p.account: { type: 'CHECKING'|'SAVINGS'|'MONEYMRKT'|'CREDITLINE'|'CREDITCARD', id, bankId, currency }
 *  p.org, p.fid, p.intuBid (QFX/QBO)
 *  p.txns: [{date, description, memo, amount, checkNum, reference}]
 *  p.closing: cents | null
 *  p.now: Date (tests)
 * @returns string (the document text; callers encode it, see encodeOfx)
 */
export function buildOfx(p) {
  const fmt = p.format || 'ofx2';
  const xml = fmt === 'ofx2';
  const acct = p.account || {};
  const isCard = acct.type === 'CREDITCARD';
  const currency = (acct.currency || 'USD').toUpperCase();
  const txns = [...p.txns].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const fitids = assignFitids(txns, acct.id || '');
  const start = txns.length ? txns[0].date : new Date().toISOString().slice(0, 10);
  const end = txns.length ? txns[txns.length - 1].date : start;
  const sum = txns.reduce((a, t) => a + t.amount, 0);
  const ledger = p.closing != null ? p.closing : sum;
  const stamp = nowStamp(p.now || new Date());
  const org = p.org || 'StatementConverter';
  const fid = p.fid || (fmt === 'ofx1' || fmt === 'ofx2' ? '' : p.intuBid || '');

  // Element helpers. SGML leaf elements are left unclosed, per OFX 1.0.2.
  const lines = [];
  let depth = 0;
  const ind = () => (xml ? '  '.repeat(depth) : '');
  const open = (tag) => { lines.push(`${ind()}<${tag}>`); depth++; };
  const close = (tag) => { depth--; lines.push(`${ind()}</${tag}>`); };
  // OFX 2 text is written as pure ASCII with numeric character references, because several
  // readers (ofxparse among them) decode XML OFX as ASCII whatever the XML declaration says.
  const xesc = (v) => esc(v).replace(/[^\x00-\x7f]/gu, (c) => `&#${c.codePointAt(0)};`);
  const leaf = (tag, v) => { lines.push(xml ? `${ind()}<${tag}>${xesc(v)}</${tag}>` : `<${tag}>${esc(v)}`); };

  open('OFX');
  open('SIGNONMSGSRSV1');
  open('SONRS');
  open('STATUS'); leaf('CODE', '0'); leaf('SEVERITY', 'INFO'); close('STATUS');
  leaf('DTSERVER', stamp);
  leaf('LANGUAGE', 'ENG');
  open('FI'); leaf('ORG', org); if (fid) leaf('FID', fid); close('FI');
  if ((fmt === 'qfx' || fmt === 'qbo') && p.intuBid) leaf('INTU.BID', p.intuBid);
  close('SONRS');
  close('SIGNONMSGSRSV1');

  open(isCard ? 'CREDITCARDMSGSRSV1' : 'BANKMSGSRSV1');
  open(isCard ? 'CCSTMTTRNRS' : 'STMTTRNRS');
  leaf('TRNUID', '1');
  open('STATUS'); leaf('CODE', '0'); leaf('SEVERITY', 'INFO'); close('STATUS');
  open(isCard ? 'CCSTMTRS' : 'STMTRS');
  leaf('CURDEF', currency);
  if (isCard) {
    open('CCACCTFROM'); leaf('ACCTID', acct.id || '0000'); close('CCACCTFROM');
  } else {
    open('BANKACCTFROM');
    leaf('BANKID', acct.bankId || '000000000');
    leaf('ACCTID', acct.id || '0000');
    leaf('ACCTTYPE', ACCT_TYPES.includes(acct.type) ? acct.type : 'CHECKING');
    close('BANKACCTFROM');
  }
  open('BANKTRANLIST');
  leaf('DTSTART', ofxDate(start));
  leaf('DTEND', ofxDate(end));
  txns.forEach((t, i) => {
    open('STMTTRN');
    const isCheck = t.checkNum && /^\d+$/.test(t.checkNum) && t.amount < 0;
    leaf('TRNTYPE', isCheck ? 'CHECK' : t.amount < 0 ? 'DEBIT' : 'CREDIT');
    leaf('DTPOSTED', ofxDate(t.date));
    leaf('TRNAMT', centsToPlain(t.amount));
    leaf('FITID', fitids[i]);
    if (isCheck) leaf('CHECKNUM', t.checkNum);
    if (t.reference) leaf('REFNUM', String(t.reference).slice(0, 32));
    let name = String(t.description || t.memo || 'Transaction').replace(/\s+/g, ' ').slice(0, 32).trim() || 'Transaction';
    // NAME is A-32. Keep the escaped form within 32 so strict readers that count
    // entities literally do not reject it.
    while (name.length > 1 && (xml ? xesc(name) : esc(name)).length > 32) name = name.slice(0, -1).trim();
    leaf('NAME', name);
    const fullDesc = String(t.description || '').replace(/\s+/g, ' ').trim();
    const memo = [fullDesc && fullDesc !== name ? fullDesc : '', t.memo].filter(Boolean).join(' / ');
    if (memo) leaf('MEMO', memo.slice(0, 255));
    close('STMTTRN');
  });
  close('BANKTRANLIST');
  open('LEDGERBAL'); leaf('BALAMT', centsToPlain(ledger)); leaf('DTASOF', ofxDate(end)); close('LEDGERBAL');
  close(isCard ? 'CCSTMTRS' : 'STMTRS');
  close(isCard ? 'CCSTMTTRNRS' : 'STMTTRNRS');
  close(isCard ? 'CREDITCARDMSGSRSV1' : 'BANKMSGSRSV1');
  close('OFX');

  if (xml) {
    const head = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
      '<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>\n';
    return head + lines.join('\n') + '\n';
  }
  const head = ['OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', 'SECURITY:NONE', 'ENCODING:USASCII',
    'CHARSET:1252', 'COMPRESSION:NONE', 'OLDFILEUID:NONE', 'NEWFILEUID:NONE', ''].join('\r\n');
  return head + '\r\n' + lines.join('\r\n') + '\r\n';
}

// Windows-1252 encoder for the SGML formats (they declare CHARSET:1252).
const CP1252_EXTRA = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

export function encodeCp1252(str) {
  const out = new Uint8Array(str.length);
  let n = 0;
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) out[n++] = c;
    else if (CP1252_EXTRA[c]) out[n++] = CP1252_EXTRA[c];
    else {
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      const bc = base.codePointAt(0);
      out[n++] = base.length === 1 && bc < 0x100 ? bc : 0x3f; // '?'
    }
  }
  return out.slice(0, n);
}

/** Bytes for download: ASCII-safe UTF-8 for OFX 2 XML, windows-1252 for SGML variants. */
export function encodeOfx(text, format) {
  return format === 'ofx2' ? new TextEncoder().encode(text) : encodeCp1252(text);
}

export const FORMAT_INFO = {
  ofx2: { ext: 'ofx', mime: 'application/x-ofx', label: 'OFX 2.2 (XML)' },
  ofx1: { ext: 'ofx', mime: 'application/x-ofx', label: 'OFX 1.0.2 (SGML)' },
  qfx: { ext: 'qfx', mime: 'application/vnd.intu.qfx', label: 'QFX (Web Connect for Quicken)' },
  qbo: { ext: 'qbo', mime: 'application/vnd.intu.qbo', label: 'QBO (Web Connect for QuickBooks Desktop)' },
};

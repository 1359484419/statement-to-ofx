// Generates synthetic statements (PDF, XLSX, CSV) with known ground truth.
// The banks and people are fictional. Output: test/fixtures/generated/
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'test/fixtures/generated');
mkdirSync(out, { recursive: true });

// Deterministic PRNG so fixtures are reproducible.
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

const fmtUS = (c) => (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtBR = (c) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (n) => String(n).padStart(2, '0');

function rightText(page, font, text, rightX, y, size) {
  page.drawText(text, { x: rightX - font.widthOfTextAtSize(text, size), y, size, font });
}

// ---------- A: English checking, Withdrawals/Deposits/Balance, crosses a year, 2 pages ----------
async function makeEnChecking() {
  const descs = [
    ['PAYROLL DEPOSIT ACME TOOLING INC', 1], ['GROCERY OUTLET #1182', -1], ['CITY WATER UTILITY AUTOPAY', -1],
    ['ATM WITHDRAWAL 4410 ELM ST', -1], ['ONLINE TRANSFER FROM SAVINGS REF 99812', 1], ['CORNER COFFEE HOUSE', -1],
    ['HARDWARE DEPOT PURCHASE', -1], ['CHECK 1043', -1], ['RENT PAYMENT - PARKVIEW APTS', -1], ['INTEREST PAYMENT', 1],
  ];
  const txns = [];
  let bal = 125000;
  const opening = bal;
  let m = 12, d = 1, y = 2025;
  for (let i = 0; i < 34; i++) {
    d += 1 + Math.floor(rnd() * 2);
    if (d > (m === 12 ? 31 : 31)) { d = 1 + Math.floor(rnd() * 3); m = m === 12 ? 1 : m + 1; if (m === 1) y = 2026; }
    const [desc, sign] = descs[Math.floor(rnd() * descs.length)];
    const amt = sign * (500 + Math.floor(rnd() * (sign > 0 ? 250000 : 60000)));
    bal += amt;
    const extra = rnd() < 0.3 ? `CARD 8812 REF ${100000 + Math.floor(rnd() * 899999)}` : null;
    txns.push({ date: `${y}-${pad(m)}-${pad(d)}`, md: `${pad(m)}/${pad(d)}`, description: desc + (extra ? ' ' + extra : ''), line1: desc, line2: extra, amount: amt, balance: bal });
  }
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const perPage = 20;
  const pages = Math.ceil(txns.length / perPage);
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([612, 792]);
    let yy = 740;
    page.drawText('Maple Street Community Bank (fictional sample)', { x: 50, y: yy, size: 14, font: bold });
    yy -= 18;
    page.drawText('Account statement - Everyday Checking ****4321', { x: 50, y: yy, size: 10, font });
    yy -= 14;
    page.drawText('Statement period: 12/01/2025 to 01/31/2026', { x: 50, y: yy, size: 10, font });
    yy -= 24;
    if (p === 0) {
      page.drawText('Beginning balance', { x: 50, y: yy, size: 10, font });
      rightText(page, font, '$' + fmtUS(opening), 550, yy, 10);
      yy -= 22;
    }
    page.drawText('Date', { x: 50, y: yy, size: 9, font: bold });
    page.drawText('Description', { x: 95, y: yy, size: 9, font: bold });
    rightText(page, bold, 'Withdrawals', 400, yy, 9);
    rightText(page, bold, 'Deposits', 475, yy, 9);
    rightText(page, bold, 'Balance', 550, yy, 9);
    yy -= 16;
    for (const t of txns.slice(p * perPage, (p + 1) * perPage)) {
      page.drawText(t.md, { x: 50, y: yy, size: 9, font });
      page.drawText(t.line1, { x: 95, y: yy, size: 9, font });
      if (t.amount < 0) rightText(page, font, fmtUS(-t.amount), 400, yy, 9);
      else rightText(page, font, fmtUS(t.amount), 475, yy, 9);
      rightText(page, font, fmtUS(t.balance), 550, yy, 9);
      yy -= 12;
      if (t.line2) { page.drawText(t.line2, { x: 95, y: yy, size: 8, font }); yy -= 12; }
      yy -= 4;
    }
    if (p === pages - 1) {
      yy -= 10;
      page.drawText('Ending balance', { x: 50, y: yy, size: 10, font });
      rightText(page, font, '$' + fmtUS(bal), 550, yy, 10);
    }
    page.drawText(`Page ${p + 1} of ${pages}`, { x: 280, y: 30, size: 8, font });
  }
  writeFileSync(join(out, 'en-checking-2page.pdf'), await doc.save());
  return { file: 'en-checking-2page.pdf', opening, closing: bal, txns: txns.map(({ date, description, amount, balance }) => ({ date, description, amount, balance })) };
}

// ---------- B: Portuguese extrato, signed Valor + Saldo only at end of day, SALDO DO DIA rows ----------
async function makePtExtrato() {
  const hist = [['PIX RECEBIDO - MARIA SOUZA', 1], ['PAGTO BOLETO ENERGIA', -1], ['COMPRA CARTAO DEB MERCADO BOM PRECO', -1],
    ['TED RECEBIDA CLIENTE LTDA', 1], ['TARIFA PACOTE SERVICOS', -1], ['PIX ENVIADO JOÃO PEREIRA', -1], ['RENDIMENTO APLICAÇÃO', 1]];
  let bal = 352050; // R$ 3.520,50
  const opening = bal;
  const txns = [];
  const lines = []; // render list
  lines.push({ kind: 'saldo', date: '31/08/2026', text: 'SALDO ANTERIOR', saldo: bal });
  for (let day = 1; day <= 28; day += 1 + Math.floor(rnd() * 3)) {
    const n = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const [h, s] = hist[Math.floor(rnd() * hist.length)];
      const amt = s * (1000 + Math.floor(rnd() * (s > 0 ? 300000 : 120000)));
      bal += amt;
      const doc = String(100000 + Math.floor(rnd() * 899999));
      const t = { date: `2026-09-${pad(day)}`, br: `${pad(day)}/09/2026`, description: h, amount: amt, doc, balance: k === n - 1 ? bal : null };
      txns.push(t);
      lines.push({ kind: 'txn', ...t });
    }
    lines.push({ kind: 'saldo', date: `${pad(day)}/09/2026`, text: 'SALDO DO DIA', saldo: bal });
  }
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595, 842]);
  let y = 800;
  page.drawText('Banco Exemplo S.A. (amostra fictícia)', { x: 40, y, size: 13, font: bold }); y -= 16;
  page.drawText('Extrato de conta corrente - Agência 0001 Conta 12345-6', { x: 40, y, size: 9, font }); y -= 13;
  page.drawText('Período: 01/09/2026 a 30/09/2026', { x: 40, y, size: 9, font }); y -= 22;
  page.drawText('Data', { x: 40, y, size: 9, font: bold });
  page.drawText('Histórico', { x: 100, y, size: 9, font: bold });
  page.drawText('Documento', { x: 310, y, size: 9, font: bold });
  rightText(page, bold, 'Valor (R$)', 470, y, 9);
  rightText(page, bold, 'Saldo (R$)', 555, y, 9);
  y -= 15;
  for (const l of lines) {
    page.drawText(l.kind === 'txn' ? l.br : l.date, { x: 40, y, size: 8.5, font });
    page.drawText(l.kind === 'txn' ? l.description : l.text, { x: 100, y, size: 8.5, font: l.kind === 'txn' ? font : bold });
    if (l.kind === 'txn') {
      page.drawText(l.doc, { x: 310, y, size: 8.5, font });
      rightText(page, font, (l.amount < 0 ? '-' : '') + fmtBR(Math.abs(l.amount)), 470, y, 8.5);
    } else rightText(page, font, fmtBR(l.saldo), 555, y, 8.5);
    y -= 13;
  }
  writeFileSync(join(out, 'pt-extrato-saldo.pdf'), await pdf.save());
  return { file: 'pt-extrato-saldo.pdf', opening, closing: bal, txns: txns.map(({ date, description, amount, balance }) => ({ date, description, amount, balance })) };
}

// ---------- C: Portuguese, D/C suffix, no balance column, dates without year ----------
async function makePtDC() {
  const hist = [['SAQUE 24H', -1], ['DEPOSITO EM DINHEIRO', 1], ['PAGAMENTO CONVENIO AGUA', -1], ['TRANSF RECEBIDA', 1], ['COMPRA ELO POSTO CENTRAL', -1]];
  let bal = 100000;
  const opening = bal;
  const txns = [];
  for (let day = 2; day <= 30; day += 2 + Math.floor(rnd() * 3)) {
    const [h, s] = hist[Math.floor(rnd() * hist.length)];
    const amt = s * (2000 + Math.floor(rnd() * 90000));
    bal += amt;
    txns.push({ date: `2026-10-${pad(day)}`, dm: `${pad(day)}/10`, description: h, amount: amt, balance: null });
  }
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  let y = 800;
  page.drawText('Cooperativa Fictícia de Crédito', { x: 40, y, size: 12, font }); y -= 15;
  page.drawText('Período: 01/10/2026 a 31/10/2026', { x: 40, y, size: 9, font }); y -= 20;
  page.drawText('Saldo anterior', { x: 40, y, size: 9, font });
  rightText(page, font, fmtBR(opening) + ' C', 520, y, 9); y -= 18;
  page.drawText('Data', { x: 40, y, size: 9, font });
  page.drawText('Lançamento', { x: 90, y, size: 9, font });
  rightText(page, font, 'Valor', 520, y, 9); y -= 14;
  for (const t of txns) {
    page.drawText(t.dm, { x: 40, y, size: 9, font });
    page.drawText(t.description, { x: 90, y, size: 9, font });
    rightText(page, font, fmtBR(Math.abs(t.amount)) + (t.amount < 0 ? ' D' : ' C'), 520, y, 9);
    y -= 13;
  }
  y -= 8;
  page.drawText('Saldo final', { x: 40, y, size: 9, font });
  rightText(page, font, fmtBR(bal) + ' C', 520, y, 9);
  writeFileSync(join(out, 'pt-extrato-dc.pdf'), await pdf.save());
  return { file: 'pt-extrato-dc.pdf', opening, closing: bal, txns };
}

// ---------- D: English, unsigned Amount + Balance (signs must come from the balance) ----------
async function makeEnUnsigned() {
  const descs = [['Salary', 1], ['Card purchase - Bookshop', -1], ['Direct debit - Gym', -1], ['Refund - Online store', 1], ['Card purchase - Pharmacy', -1]];
  let bal = 50000;
  const opening = bal;
  const txns = [];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (let day = 1; day <= 28; day += 2 + Math.floor(rnd() * 2)) {
    const [desc, s] = descs[Math.floor(rnd() * descs.length)];
    const amt = s * (300 + Math.floor(rnd() * 40000));
    bal += amt;
    txns.push({ date: `2026-03-${pad(day)}`, label: `${months[2]} ${day}, 2026`, description: desc, amount: amt, balance: bal });
  }
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  let y = 740;
  page.drawText('Riverside Savings (fictional sample) - March 2026', { x: 50, y, size: 12, font }); y -= 22;
  page.drawText('Opening balance', { x: 50, y, size: 10, font });
  rightText(page, font, fmtUS(opening), 550, y, 10); y -= 22;
  page.drawText('Date', { x: 50, y, size: 9, font });
  page.drawText('Description', { x: 140, y, size: 9, font });
  rightText(page, font, 'Amount', 460, y, 9);
  rightText(page, font, 'Balance', 550, y, 9); y -= 15;
  for (const t of txns) {
    page.drawText(t.label, { x: 50, y, size: 9, font });
    page.drawText(t.description, { x: 140, y, size: 9, font });
    rightText(page, font, fmtUS(Math.abs(t.amount)), 460, y, 9);
    rightText(page, font, fmtUS(t.balance), 550, y, 9);
    y -= 14;
  }
  y -= 8;
  page.drawText('Closing balance', { x: 50, y, size: 10, font });
  rightText(page, font, fmtUS(bal), 550, y, 10);
  writeFileSync(join(out, 'en-unsigned-balance.pdf'), await pdf.save());
  return { file: 'en-unsigned-balance.pdf', opening, closing: bal, txns: txns.map(({ date, description, amount, balance }) => ({ date, description, amount, balance })) };
}

// ---------- E: XLSX with real date and number cells (Portuguese headers) ----------
function makeXlsx() {
  const rows = [['Extrato - Conta 12345-6 (amostra)'], [], ['Data', 'Descrição', 'Valor', 'Saldo']];
  let bal = 200000;
  const txns = [];
  for (let i = 1; i <= 15; i++) {
    const amt = (i % 3 === 0 ? 1 : -1) * (1000 + i * 731);
    bal += amt;
    const date = `2026-07-${pad(i * 2 - 1)}`;
    txns.push({ date, description: `Lançamento ${i}`, amount: amt, balance: bal });
    rows.push([new Date(Date.UTC(2026, 6, i * 2 - 1, 12)), `Lançamento ${i}`, amt / 100, bal / 100]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
  for (let r = 3; r < rows.length; r++) {
    const a = XLSX.utils.encode_cell({ r, c: 0 });
    ws[a].z = 'dd/mm/yyyy';
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Extrato');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  writeFileSync(join(out, 'pt-extrato.xlsx'), buf);
  return { file: 'pt-extrato.xlsx', opening: 200000, closing: bal, txns };
}

// ---------- F: Brazilian CSV with ; and decimal comma ----------
function makeBrCsv() {
  const lines = ['Data;Histórico;Valor;Saldo'];
  let bal = 1000000;
  const txns = [];
  for (let i = 1; i <= 12; i++) {
    const amt = (i % 4 === 0 ? 1 : -1) * (12345 * i);
    bal += amt;
    const date = `2026-05-${pad(i)}`;
    txns.push({ date, description: `PIX ${i} PADARIA SÃO JOSÉ`, amount: amt, balance: bal });
    lines.push(`${pad(i)}/05/2026;PIX ${i} PADARIA SÃO JOSÉ;${fmtBR(amt)};${fmtBR(bal)}`);
  }
  writeFileSync(join(out, 'br-extrato.csv'), lines.join('\r\n'));
  return { file: 'br-extrato.csv', opening: 1000000, closing: bal, txns };
}

const truth = [await makeEnChecking(), await makePtExtrato(), await makePtDC(), await makeEnUnsigned(), makeXlsx(), makeBrCsv()];
writeFileSync(join(out, 'truth.json'), JSON.stringify(truth, null, 1));
console.log('fixtures:', truth.map((t) => `${t.file} (${t.txns.length} txns)`).join(', '));

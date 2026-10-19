// Page controller. Everything runs locally: files are read with FileReader/arrayBuffer,
// parsed in this tab, and downloads are created from Blobs. No network calls are made
// except loading this site's own scripts (and bundled sample files when you click them).

import { createHarness, installNetworkGuard } from './core/harness.js';
import { parseDelimited, decodeText } from './core/csv.js';
import { autoDetect, applyMapping, guessMapping, PRESETS, mappingForPreset, guessOptions } from './core/mapping.js';
import { validateStatement } from './core/validate.js';
import { parseAmount, formatCents } from './core/numbers.js';
import { parseDate } from './core/dates.js';
import { exportStatement, FORMATS } from './export/index.js';

const LANG = document.documentElement.lang.startsWith('pt') ? 'pt' : 'en';
const ROOT = document.documentElement.dataset.root || './';

const STR = {
  en: {
    drop: 'Drop a statement here or click to choose',
    dropHint: 'CSV, TSV, TXT, XLSX, XLS, ODS or a text-based PDF. Nothing is uploaded.',
    samples: 'No file handy? Try a sample:',
    sampleCsv: 'Bank CSV', samplePdf: 'Statement PDF',
    s2: 'Check the columns', s2pdf: 'Check what was read from the PDF',
    s3: 'Review and fix', s4: 'Export',
    preset: 'Layout', presetAuto: 'Auto-detect', presetNone: '(none matched — using auto-detect)',
    headerRow: 'Header row', headerNone: 'No header row',
    dateOrder: 'Date order', decimal: 'Decimal separator', dot: 'Dot (1,234.56)', comma: 'Comma (1.234,56)',
    invert: 'Flip all signs (use for card statements that print charges as positive)',
    year: 'Statement year (for dates without a year)',
    roles: { '': '— ignore —', date: 'Date', description: 'Description', memo: 'Memo / extra text', amount: 'Amount (signed)', debit: 'Debit / money out', credit: 'Credit / money in', balance: 'Running balance', dcFlag: 'Debit/credit flag', checkNum: 'Check number', reference: 'Reference / ID' },
    count: 'Transactions', credits: 'Money in', debits: 'Money out', opening: 'Opening balance', closing: 'Closing balance', period: 'Period',
    openingIn: 'Opening balance (from statement)', closingIn: 'Closing balance (from statement)',
    chkRunning: (c) => c.ok ? `Running balance continuous across ${c.checked} rows` : `Running balance breaks on ${c.failed} of ${c.checked} rows (highlighted)`,
    chkTotals: (c) => c.ok ? 'Opening + transactions = closing' : `Opening + transactions is off by ${fmt(c.diff)} from closing`,
    chkStated: (c) => `Closing balance on the statement (${fmt(c.stated)}) differs from the last running balance (${fmt(c.derived)})`,
    chkNone: 'No balances available, so totals cannot be cross-checked. Enter the opening and closing balance from your statement to check them.',
    rejected: (n) => `${n} row(s) skipped because they had no valid date or amount (totals, headers, notes).`,
    unparsed: (n) => `${n} line(s) looked like data but were not used. Check them against your statement:`,
    unsigned: 'Amounts on this PDF carry no sign and there is no balance column, so every row is treated as money in. Flip signs or fix rows below before exporting.',
    noRows: 'No transactions were found. If this PDF is a scan (an image of paper), it has no text to read; scanned statements are not supported yet.',
    noText: 'This PDF has no text layer (it is probably a scan). Scanned statements are not supported yet.',
    signBalance: 'Signs were worked out from the running balance column.',
    issues: { balance: 'balance mismatch', date: 'bad date', zero: 'zero amount', nodesc: 'no description', duplicate: 'possible duplicate', order: 'out of date order' },
    onlyIssues: 'Show only rows with issues', addRow: 'Add row', del: 'Delete row',
    cols: ['Date', 'Description', 'Amount', 'Balance', ''],
    acctType: 'Account type', acctId: 'Account number (last digits are fine)', bankId: 'Bank / routing ID', currency: 'Currency',
    intuBid: 'INTU.BID (QFX/QBO only)', xeroDate: 'Xero date format',
    types: { CHECKING: 'Checking', SAVINGS: 'Savings', CREDITCARD: 'Credit card', MONEYMRKT: 'Money market', CREDITLINE: 'Line of credit' },
    fmtNotes: {
      ofx2: 'Standard OFX 2.2 XML. Works with most personal finance apps and GnuCash.',
      ofx1: 'Older SGML OFX 1.0.2. Pick this if an app rejects OFX 2.',
      qfx: 'Web Connect file for use with Quicken. Experimental: Quicken checks the INTU.BID value.',
      qbo: 'Web Connect file for QuickBooks Desktop. Experimental: needs an INTU.BID your version accepts.',
      xero: 'Xero bank statement import CSV (Date, Amount, Payee, Description, Reference).',
    },
    exportBlocked: 'Fix the highlighted problems first, or tick the box to export anyway.',
    exportAnyway: 'I checked the rows; export even though checks fail',
    downloaded: (f) => `Saved ${f}. Import it in your app and compare the totals with your statement.`,
    editsReset: 'Changing the column setup re-reads the file and discards manual edits.',
    tooBig: 'This file is very large; the table shows 250 rows per page.',
    page: (a, b) => `Page ${a} of ${b}`, prev: 'Previous', next: 'Next',
    log: 'Activity log (what ran, and that no network request was made)',
    blocked: (u) => `Blocked a network request to ${u}`,
    pwd: 'This PDF is password protected. Enter the password (it stays in this tab):',
    errRead: 'Could not read this file: ',
  },
  pt: {
    drop: 'Arraste o extrato aqui ou clique para escolher',
    dropHint: 'CSV, TXT, XLSX, XLS, ODS ou PDF com texto. Nada é enviado para servidor.',
    samples: 'Sem arquivo à mão? Teste com um exemplo:',
    sampleCsv: 'CSV de extrato', samplePdf: 'Extrato em PDF',
    s2: 'Confira as colunas', s2pdf: 'Confira o que foi lido do PDF',
    s3: 'Revise e corrija', s4: 'Exportar',
    preset: 'Layout', presetAuto: 'Detectar automaticamente', presetNone: '(nenhum reconhecido — detecção automática)',
    headerRow: 'Linha de cabeçalho', headerNone: 'Sem cabeçalho',
    dateOrder: 'Ordem da data', decimal: 'Separador decimal', dot: 'Ponto (1,234.56)', comma: 'Vírgula (1.234,56)',
    invert: 'Inverter todos os sinais (para faturas de cartão que mostram compras como positivas)',
    year: 'Ano do extrato (para datas sem ano)',
    roles: { '': '— ignorar —', date: 'Data', description: 'Histórico', memo: 'Complemento', amount: 'Valor (com sinal)', debit: 'Débito / saída', credit: 'Crédito / entrada', balance: 'Saldo', dcFlag: 'Indicador D/C', checkNum: 'Nº do cheque', reference: 'Documento / ID' },
    count: 'Lançamentos', credits: 'Entradas', debits: 'Saídas', opening: 'Saldo anterior', closing: 'Saldo final', period: 'Período',
    openingIn: 'Saldo anterior (do extrato)', closingIn: 'Saldo final (do extrato)',
    chkRunning: (c) => c.ok ? `Saldo contínuo em ${c.checked} linhas` : `O saldo não fecha em ${c.failed} de ${c.checked} linhas (destacadas)`,
    chkTotals: (c) => c.ok ? 'Saldo anterior + lançamentos = saldo final' : `Saldo anterior + lançamentos difere do saldo final em ${fmt(c.diff)}`,
    chkStated: (c) => `O saldo final impresso (${fmt(c.stated)}) difere do último saldo da tabela (${fmt(c.derived)})`,
    chkNone: 'Sem saldos para conferir. Informe o saldo anterior e o saldo final do extrato para validar os totais.',
    rejected: (n) => `${n} linha(s) ignorada(s) por não terem data ou valor válidos (totais, cabeçalhos, observações).`,
    unparsed: (n) => `${n} linha(s) pareciam dados mas não foram usadas. Confira no extrato:`,
    unsigned: 'Os valores deste PDF não têm sinal nem coluna de saldo; todos foram tratados como entrada. Inverta os sinais ou corrija as linhas antes de exportar.',
    noRows: 'Nenhum lançamento encontrado. Se o PDF for digitalizado (imagem), não há texto para ler; extratos digitalizados ainda não são suportados.',
    noText: 'Este PDF não tem camada de texto (provavelmente é digitalizado). Ainda não suportamos extratos digitalizados.',
    signBalance: 'Os sinais foram deduzidos pela coluna de saldo.',
    issues: { balance: 'saldo não fecha', date: 'data inválida', zero: 'valor zero', nodesc: 'sem histórico', duplicate: 'possível duplicado', order: 'fora de ordem' },
    onlyIssues: 'Mostrar só linhas com problema', addRow: 'Adicionar linha', del: 'Excluir linha',
    cols: ['Data', 'Histórico', 'Valor', 'Saldo', ''],
    acctType: 'Tipo de conta', acctId: 'Número da conta', bankId: 'Código do banco / agência', currency: 'Moeda',
    intuBid: 'INTU.BID (só QFX/QBO)', xeroDate: 'Formato de data (Xero)',
    types: { CHECKING: 'Conta corrente', SAVINGS: 'Poupança', CREDITCARD: 'Cartão de crédito', MONEYMRKT: 'Investimento', CREDITLINE: 'Cheque especial' },
    fmtNotes: {
      ofx2: 'OFX 2.2 (XML). Para a maioria dos programas e do GnuCash.',
      ofx1: 'OFX 1.0.2 (SGML), o formato que os bancos brasileiros costumam gerar. Use este para sistemas contábeis.',
      qfx: 'Arquivo Web Connect para uso com Quicken (experimental).',
      qbo: 'Arquivo Web Connect para QuickBooks Desktop (experimental).',
      xero: 'CSV de importação de extrato do Xero.',
    },
    exportBlocked: 'Corrija os problemas destacados ou marque a opção para exportar mesmo assim.',
    exportAnyway: 'Conferi as linhas; exportar mesmo com divergências',
    downloaded: (f) => `Arquivo ${f} salvo. Importe no seu sistema e confira os totais com o extrato.`,
    editsReset: 'Mudar as colunas relê o arquivo e descarta edições manuais.',
    tooBig: 'Arquivo grande: a tabela mostra 250 linhas por página.',
    page: (a, b) => `Página ${a} de ${b}`, prev: 'Anterior', next: 'Próxima',
    log: 'Registro de atividade (o que rodou e a confirmação de que nada foi enviado)',
    blocked: (u) => `Requisição bloqueada para ${u}`,
    pwd: 'Este PDF tem senha. Digite a senha (ela fica só nesta aba):',
    errRead: 'Não foi possível ler este arquivo: ',
  },
}[LANG];

const DEC = LANG === 'pt' ? 'comma' : 'dot';
const clean = (...kids) => kids.flat().filter((k) => k != null && k !== false);
const fmt = (c) => (c == null ? '—' : formatCents(c, DEC));
const $ = (sel, el = document) => el.querySelector(sel);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
};

// ------------------------------------------------------------------ state
const state = {
  file: null, kind: null,
  allRows: null, headerRow: -1, mapping: {}, options: {}, preset: null, rejected: [],
  pdf: null, pdfOpts: {},
  txns: [], stated: { opening: null, closing: null },
  invert: false, page: 0, onlyIssues: false, validation: null, forceExport: false,
};

const logEl = () => $('#log');
const harness = createHarness({
  onEvent: (e) => {
    const el = logEl();
    if (!el) return;
    const t = new Date(e.t).toLocaleTimeString();
    el.textContent += `${t}  ${e.type.padEnd(6)} ${e.stage || ''}${e.ms != null ? ` (${e.ms} ms)` : ''}${e.message ? ' — ' + e.message : ''}\n`;
    el.scrollTop = el.scrollHeight;
  },
});
installNetworkGuard((u) => harness.emit({ type: 'block', stage: 'network', message: STR.blocked(u) }));

// ------------------------------------------------------------------ DOM skeleton
function build() {
  const tool = $('#tool');
  tool.append(
    h('section', { class: 'card', id: 'step1' },
      h('h2', {}, h('span', { class: 'step' }, '1'), LANG === 'pt' ? 'Escolha o arquivo' : 'Choose a file'),
      h('div', { class: 'drop', id: 'drop', tabindex: '0', role: 'button', 'aria-label': STR.drop },
        h('strong', {}, STR.drop), h('small', {}, STR.dropHint)),
      h('input', { type: 'file', id: 'file', class: 'hidden', accept: '.csv,.tsv,.txt,.xlsx,.xlsm,.xls,.ods,.pdf' }),
      h('p', { class: 'small muted' }, STR.samples, ' ',
        h('button', { class: 'link', id: 'sample-csv', type: 'button' }, STR.sampleCsv), ' · ',
        h('button', { class: 'link', id: 'sample-pdf', type: 'button' }, STR.samplePdf)),
      h('div', { id: 'load-error', class: 'error hidden', role: 'alert' })),
    h('section', { class: 'card hidden', id: 'step2' }),
    h('section', { class: 'card hidden', id: 'step3' }),
    h('section', { class: 'card hidden', id: 'step4' }),
    h('details', { class: 'card small' }, h('summary', {}, STR.log), h('div', { class: 'log', id: 'log', 'aria-live': 'polite' })),
  );
  const drop = $('#drop'), input = $('#file');
  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); });
  input.addEventListener('change', () => { if (input.files[0]) load(input.files[0]); input.value = ''; });
  $('#sample-csv').addEventListener('click', () => loadSample(LANG === 'pt' ? 'br-extrato.csv' : 'schwab-checking.csv'));
  $('#sample-pdf').addEventListener('click', () => loadSample(LANG === 'pt' ? 'pt-extrato-saldo.pdf' : 'en-checking-2page.pdf'));
}

async function loadSample(name) {
  const res = await fetch(`${ROOT}samples/${name}`);
  const blob = await res.blob();
  load(new File([blob], name));
}

function showError(msg) {
  const el = $('#load-error');
  el.textContent = msg;
  el.classList.toggle('hidden', !msg);
}

// ------------------------------------------------------------------ loading
async function load(file) {
  showError('');
  try {
    const kind = harness.checkInput(file);
    Object.assign(state, { file, kind, pdf: null, allRows: null, txns: [], stated: { opening: null, closing: null }, invert: false, page: 0, forceExport: false, rejected: [] });
    const buf = new Uint8Array(await harness.stage('read file', () => file.arrayBuffer()));
    if (kind === 'pdf') await loadPdf(buf);
    else {
      let rows;
      if (kind === 'sheet') {
        const XLSX = await harness.stage('load spreadsheet reader', () => import('../vendor/xlsx/xlsx.mjs'));
        const { sheetToRows } = await import('./core/sheet.js');
        rows = (await harness.stage('read spreadsheet', () => sheetToRows(XLSX, buf))).rows;
      } else {
        rows = (await harness.stage('parse text', () => parseDelimited(decodeText(buf)))).rows;
      }
      if (!rows.length) throw new Error(LANG === 'pt' ? 'arquivo vazio' : 'the file is empty');
      state.allRows = rows;
      const det = await harness.stage('detect columns', () => autoDetect(rows, LANG));
      Object.assign(state, { headerRow: det.headerRow, mapping: det.mapping, options: det.options, preset: det.preset });
      recomputeTabular();
      renderMapping();
    }
    $('#step2').classList.remove('hidden');
    renderReview();
    renderExport();
    $('#step2').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    harness.emit({ type: 'error', stage: 'load', message: String(err.message || err) });
    showError(STR.errRead + (err.message || err));
  }
}

async function loadPdf(buf, password) {
  const pdfjs = await harness.stage('load PDF reader', () => import('../vendor/pdfjs/pdf.min.mjs'));
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const { parsePdfStatement } = await import('./core/pdftext.js');
  state.pdfBytes = buf;
  try {
    state.pdf = await harness.stage('read PDF text', () => parsePdfStatement(pdfjs, buf.slice(), { locale: LANG, password, ...state.pdfOpts }));
  } catch (err) {
    if (err && err.name === 'PasswordException') {
      const pw = window.prompt(STR.pwd);
      if (pw) return loadPdf(buf, pw);
    }
    throw err;
  }
  state.pdfPassword = password;
  state.stated = { opening: state.pdf.opening, closing: state.pdf.closing };
  state.txns = state.pdf.txns.map((t) => ({ ...t }));
  renderPdfPanel();
}

function recomputeTabular() {
  const data = state.allRows.slice(state.headerRow + 1);
  const { txns, rejected } = applyMapping(data, state.mapping, state.options);
  state.txns = txns;
  state.rejected = rejected;
  state.page = 0;
}

// ------------------------------------------------------------------ step 2 (tabular)
function renderMapping() {
  const sec = $('#step2');
  sec.replaceChildren();
  const headers = state.headerRow >= 0 ? state.allRows[state.headerRow] : null;
  const data = state.allRows.slice(state.headerRow + 1);
  const ncol = Math.max(...state.allRows.slice(0, 60).map((r) => r.length));

  const presetSel = h('select', { id: 'preset' },
    h('option', { value: '' }, STR.presetAuto),
    PRESETS.map((p) => h('option', { value: p.id, selected: state.preset === p.id }, p.name)));
  presetSel.addEventListener('change', () => {
    if (presetSel.value && headers) {
      const m = mappingForPreset(presetSel.value, headers);
      if (m) state.mapping = m;
      const p = PRESETS.find((x) => x.id === presetSel.value);
      state.options = { ...state.options, ...p.options };
    } else {
      const det = autoDetect(state.allRows, LANG);
      state.mapping = det.mapping; state.options = det.options;
    }
    state.preset = presetSel.value || null;
    recomputeTabular(); renderMapping(); renderReview();
  });

  const hdrSel = h('select', { id: 'header-row' },
    h('option', { value: '-1', selected: state.headerRow === -1 }, STR.headerNone),
    state.allRows.slice(0, 30).map((r, i) => h('option', { value: String(i), selected: state.headerRow === i }, `${i + 1}: ${r.filter(Boolean).slice(0, 4).join(' | ').slice(0, 60)}`)));
  hdrSel.addEventListener('change', () => {
    state.headerRow = Number(hdrSel.value);
    const hdr = state.headerRow >= 0 ? state.allRows[state.headerRow] : null;
    const rows = state.allRows.slice(state.headerRow + 1);
    state.mapping = guessMapping(hdr, rows, LANG);
    state.options = guessOptions(rows, state.mapping, LANG);
    state.preset = null;
    recomputeTabular(); renderMapping(); renderReview();
  });

  const orderSel = h('select', { id: 'date-order' }, ['MDY', 'DMY', 'YMD'].map((o) => h('option', { value: o, selected: state.options.dateOrder === o }, o.split('').join('/'))));
  orderSel.addEventListener('change', () => { state.options.dateOrder = orderSel.value; recomputeTabular(); renderReview(); });
  const decSel = h('select', { id: 'decimal' }, h('option', { value: 'dot', selected: state.options.decimal === 'dot' }, STR.dot), h('option', { value: 'comma', selected: state.options.decimal === 'comma' }, STR.comma));
  decSel.addEventListener('change', () => { state.options.decimal = decSel.value; recomputeTabular(); renderReview(); });
  const inv = h('input', { type: 'checkbox', id: 'invert', checked: state.options.invert });
  inv.addEventListener('change', () => { state.options.invert = inv.checked; recomputeTabular(); renderReview(); });

  // Preview table with a role picker above each column
  const roleOf = (i) => Object.entries(state.mapping).find(([, idx]) => idx === i)?.[0] || '';
  const pickers = [];
  for (let i = 0; i < ncol; i++) {
    const sel = h('select', { 'data-col': String(i), 'aria-label': `Column ${i + 1}` },
      Object.entries(STR.roles).map(([v, label]) => h('option', { value: v, selected: roleOf(i) === v }, label)));
    sel.addEventListener('change', () => {
      for (const [r, idx] of Object.entries(state.mapping)) if (idx === i) delete state.mapping[r];
      if (sel.value) {
        delete state.mapping[sel.value];
        state.mapping[sel.value] = i;
        // amount and debit/credit are alternatives
        if (sel.value === 'amount') { delete state.mapping.debit; delete state.mapping.credit; }
        if (sel.value === 'debit' || sel.value === 'credit') delete state.mapping.amount;
      }
      state.preset = null;
      recomputeTabular(); renderMapping(); renderReview();
    });
    pickers.push(h('th', {}, sel));
  }
  const preview = h('table', { class: 'preview' },
    h('thead', {}, h('tr', {}, pickers), headers ? h('tr', {}, Array.from({ length: ncol }, (_, i) => h('th', { class: 'muted' }, headers[i] ?? ''))) : null),
    h('tbody', {}, data.slice(0, 8).map((r) => h('tr', {}, Array.from({ length: ncol }, (_, i) => h('td', { title: String(r[i] ?? '') }, String(r[i] ?? '')))))));

  sec.replaceChildren(...clean(
    h('h2', {}, h('span', { class: 'step' }, '2'), STR.s2),
    h('p', { class: 'small muted' }, `${state.file.name} · ${data.length} rows · ${STR.editsReset}`),
    h('div', { class: 'row' },
      h('div', { class: 'field' }, h('label', { for: 'preset' }, STR.preset), presetSel),
      h('div', { class: 'field' }, h('label', { for: 'header-row' }, STR.headerRow), hdrSel),
      h('div', { class: 'field' }, h('label', { for: 'date-order' }, STR.dateOrder), orderSel),
      h('div', { class: 'field' }, h('label', { for: 'decimal' }, STR.decimal), decSel)),
    h('p', {}, h('label', { class: 'check' }, inv, STR.invert)),
    h('div', { class: 'scroll' }, preview),
    state.rejected.length ? h('p', { class: 'small muted' }, STR.rejected(state.rejected.length)) : null,
  ));
}

// ------------------------------------------------------------------ step 2 (pdf)
function renderPdfPanel() {
  const sec = $('#step2');
  sec.replaceChildren();
  const r = state.pdf;
  const notes = [];
  if (r.warnings.includes('no-text')) notes.push(h('p', { class: 'error' }, STR.noText));
  else if (r.warnings.includes('no-rows')) notes.push(h('p', { class: 'error' }, STR.noRows));
  if (r.warnings.includes('unsigned')) notes.push(h('p', { class: 'notice' }, STR.unsigned));
  if (r.signSource === 'balance') notes.push(h('p', { class: 'small muted' }, STR.signBalance));

  const orderSel = h('select', { id: 'pdf-date-order' }, ['MDY', 'DMY'].map((o) => h('option', { value: o, selected: r.dateOrder === o }, o.split('').join('/'))));
  const yearIn = h('input', { type: 'number', id: 'pdf-year', value: String(r.year || ''), min: '1990', max: '2100' });
  const decSel = h('select', { id: 'pdf-decimal' }, h('option', { value: 'dot', selected: r.decimal === 'dot' }, STR.dot), h('option', { value: 'comma', selected: r.decimal === 'comma' }, STR.comma));
  const reparse = async () => {
    state.pdfOpts = { dateOrder: orderSel.value, year: Number(yearIn.value) || undefined, decimal: decSel.value };
    const wasInverted = state.invert;
    state.invert = false;
    await loadPdf(state.pdfBytes, state.pdfPassword);
    if (wasInverted) { setInvert(true); renderPdfPanel(); }
    renderReview();
  };
  [orderSel, yearIn, decSel].forEach((el) => el.addEventListener('change', reparse));
  const inv = h('input', { type: 'checkbox', id: 'invert', checked: state.invert });
  inv.addEventListener('change', () => { setInvert(inv.checked); renderReview(); });

  sec.replaceChildren(...clean(
    h('h2', {}, h('span', { class: 'step' }, '2'), STR.s2pdf),
    h('p', { class: 'small muted' }, `${state.file.name} · ${r.pages} page(s) · ${r.txns.length} ${STR.count.toLowerCase()}`),
    ...notes,
    h('div', { class: 'row' },
      h('div', { class: 'field' }, h('label', { for: 'pdf-date-order' }, STR.dateOrder), orderSel),
      h('div', { class: 'field' }, h('label', { for: 'pdf-year' }, STR.year), yearIn),
      h('div', { class: 'field' }, h('label', { for: 'pdf-decimal' }, STR.decimal), decSel)),
    h('p', {}, h('label', { class: 'check' }, inv, STR.invert)),
    r.unparsed && r.unparsed.length ? h('details', {}, h('summary', { class: 'small' }, STR.unparsed(r.unparsed.length)),
      h('ul', { class: 'small mono' }, r.unparsed.slice(0, 100).map((l) => h('li', {}, l)))) : null,
  ));
}

function setInvert(on) {
  if (on === state.invert) return;
  state.invert = on;
  state.txns.forEach((t) => { t.amount = -t.amount; if (t.balance != null) t.balance = -t.balance; });
  if (state.stated.opening != null) state.stated.opening = -state.stated.opening;
  if (state.stated.closing != null) state.stated.closing = -state.stated.closing;
}

// ------------------------------------------------------------------ step 3
const PAGE = 250;
function renderReview() {
  const sec = $('#step3');
  sec.classList.remove('hidden');
  const v = state.validation = validateStatement(state.txns, state.stated);
  const s = v.summary;
  const checks = [];
  for (const c of v.checks) {
    if (c.id === 'running') checks.push(h('li', { class: c.ok ? 'ok' : 'bad' }, STR.chkRunning(c)));
    if (c.id === 'totals') checks.push(h('li', { class: c.ok ? 'ok' : 'bad' }, STR.chkTotals(c)));
    if (c.id === 'stated-closing') checks.push(h('li', { class: 'bad' }, STR.chkStated(c)));
  }
  if (!v.checks.length) checks.push(h('li', { class: 'warn' }, STR.chkNone));

  const openIn = h('input', { type: 'text', id: 'stated-opening', inputmode: 'decimal', value: state.stated.opening != null ? formatCents(state.stated.opening, DEC, false) : '' });
  const closeIn = h('input', { type: 'text', id: 'stated-closing', inputmode: 'decimal', value: state.stated.closing != null ? formatCents(state.stated.closing, DEC, false) : '' });
  const onStated = (key, el) => () => {
    const a = parseAmount(el.value, 'auto');
    state.stated[key] = el.value.trim() === '' ? null : a ? a.cents : state.stated[key];
    renderReview(); renderExport();
  };
  openIn.addEventListener('change', onStated('opening', openIn));
  closeIn.addEventListener('change', onStated('closing', closeIn));

  const only = h('input', { type: 'checkbox', id: 'only-issues', checked: state.onlyIssues });
  only.addEventListener('change', () => { state.onlyIssues = only.checked; state.page = 0; renderReview(); });

  let idxs = state.txns.map((_, i) => i);
  if (state.onlyIssues) idxs = idxs.filter((i) => v.rowIssues[i]);
  const pages = Math.max(1, Math.ceil(idxs.length / PAGE));
  state.page = Math.min(state.page, pages - 1);
  const shown = idxs.slice(state.page * PAGE, (state.page + 1) * PAGE);

  const body = h('tbody', {}, shown.map((i) => rowEl(i, v.rowIssues[i])));
  const table = h('table', { class: 'edit', id: 'txn-table' },
    h('thead', {}, h('tr', {}, STR.cols.map((c, k) => h('th', { class: k === 2 || k === 3 ? 'num' : null }, c)))), body);

  const pager = pages > 1 ? h('div', { class: 'pager small' },
    h('button', { type: 'button', disabled: state.page === 0, onclick: () => { state.page--; renderReview(); } }, STR.prev),
    h('span', {}, STR.page(state.page + 1, pages)),
    h('button', { type: 'button', disabled: state.page >= pages - 1, onclick: () => { state.page++; renderReview(); } }, STR.next)) : null;

  sec.replaceChildren(...clean(
    h('h2', {}, h('span', { class: 'step' }, '3'), STR.s3),
    h('div', { class: 'stats' },
      stat(STR.count, String(s.count), 'stat-count'), stat(STR.credits, fmt(s.credits), 'stat-credits'), stat(STR.debits, fmt(s.debits), 'stat-debits'),
      stat(STR.opening, fmt(s.opening), 'stat-opening'), stat(STR.closing, fmt(s.closing), 'stat-closing'),
      stat(STR.period, s.start ? `${s.start} → ${s.end}` : '—', 'stat-period')),
    h('ul', { class: 'checks', id: 'checks' }, checks),
    h('div', { class: 'row' },
      h('div', { class: 'field' }, h('label', { for: 'stated-opening' }, STR.openingIn), openIn),
      h('div', { class: 'field' }, h('label', { for: 'stated-closing' }, STR.closingIn), closeIn)),
    h('p', { class: 'row' }, h('label', { class: 'check' }, only, STR.onlyIssues),
      h('button', { type: 'button', id: 'add-row', onclick: addRow }, STR.addRow)),
    state.txns.length > PAGE ? h('p', { class: 'small muted' }, STR.tooBig) : null,
    h('div', { class: 'scroll' }, table),
    pager,
  ));
  renderExport();
}

function stat(k, v, id) { return h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v', id }, v)); }

function rowEl(i, issues) {
  const t = state.txns[i];
  const date = h('input', { type: 'date', value: t.date || '', 'aria-label': STR.cols[0] });
  const desc = h('input', { type: 'text', class: 'desc', value: t.description || '', 'aria-label': STR.cols[1] });
  const amt = h('input', { type: 'text', class: 'amt', inputmode: 'decimal', value: formatCents(t.amount, DEC, false), 'aria-label': STR.cols[2] });
  const bal = h('input', { type: 'text', class: 'amt', inputmode: 'decimal', value: t.balance != null ? formatCents(t.balance, DEC, false) : '', 'aria-label': STR.cols[3] });
  date.addEventListener('change', () => { t.date = parseDate(date.value, 'YMD') || t.date; renderReview(); });
  desc.addEventListener('change', () => { t.description = desc.value; renderReview(); });
  amt.addEventListener('change', () => { const a = parseAmount(amt.value, DEC); if (a) t.amount = a.cents; renderReview(); });
  bal.addEventListener('change', () => { const a = parseAmount(bal.value, DEC); t.balance = bal.value.trim() === '' ? null : a ? a.cents : t.balance; renderReview(); });
  const del = h('button', { type: 'button', class: 'link', title: STR.del, 'aria-label': STR.del, onclick: () => { state.txns.splice(i, 1); renderReview(); } }, '×');
  const hard = issues && issues.some((c) => c === 'balance' || c === 'date');
  return h('tr', { class: hard ? 'bad' : issues ? 'warn' : null, 'data-i': String(i) },
    h('td', {}, date),
    h('td', {}, desc, issues ? h('div', { class: 'issue' }, issues.map((c) => STR.issues[c] || c).join(' · ')) : null),
    h('td', { class: 'num' }, amt), h('td', { class: 'num' }, bal), h('td', {}, del));
}

function addRow() {
  const last = state.txns[state.txns.length - 1];
  state.txns.push({ date: last ? last.date : new Date().toISOString().slice(0, 10), description: '', memo: '', amount: 0, balance: null, checkNum: '', reference: '' });
  state.page = Math.floor((state.txns.length - 1) / PAGE);
  renderReview();
}

// ------------------------------------------------------------------ step 4
const exportPrefs = (() => {
  try { return JSON.parse(localStorage.getItem('stb-export') || '{}'); } catch { return {}; }
})();

function renderExport() {
  const sec = $('#step4');
  if (!state.txns.length) { sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');
  const v = state.validation;
  const blocked = v && !v.ok && !state.forceExport;
  const p = {
    type: exportPrefs.type || 'CHECKING', id: exportPrefs.id || '', bankId: exportPrefs.bankId || '',
    currency: exportPrefs.currency || (LANG === 'pt' ? 'BRL' : 'USD'), intuBid: exportPrefs.intuBid || '3000',
    xeroDate: exportPrefs.xeroDate || (LANG === 'pt' ? 'DD/MM/YYYY' : 'MM/DD/YYYY'),
  };
  const keep = (k) => (e) => { exportPrefs[k] = e.target.value; try { localStorage.setItem('stb-export', JSON.stringify(exportPrefs)); } catch {} };
  const type = h('select', { id: 'acct-type', onchange: keep('type') }, Object.entries(STR.types).map(([k, l]) => h('option', { value: k, selected: p.type === k }, l)));
  const id = h('input', { type: 'text', id: 'acct-id', value: p.id, placeholder: '0000', onchange: keep('id') });
  const bank = h('input', { type: 'text', id: 'bank-id', value: p.bankId, placeholder: LANG === 'pt' ? '0001' : '123456789', onchange: keep('bankId') });
  const cur = h('input', { type: 'text', id: 'currency', value: p.currency, maxlength: '3', onchange: keep('currency') });
  const bid = h('input', { type: 'text', id: 'intu-bid', value: p.intuBid, onchange: keep('intuBid') });
  const xd = h('select', { id: 'xero-date', onchange: keep('xeroDate') }, ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'].map((f) => h('option', { value: f, selected: p.xeroDate === f }, f)));
  const force = h('input', { type: 'checkbox', id: 'force-export', checked: state.forceExport });
  force.addEventListener('change', () => { state.forceExport = force.checked; renderExport(); });
  const msg = h('p', { class: 'small', id: 'export-msg', 'aria-live': 'polite' });

  const order = LANG === 'pt' ? ['ofx1', 'ofx2', 'xero', 'qfx', 'qbo'] : ['qfx', 'qbo', 'ofx2', 'ofx1', 'xero'];
  const buttons = order.map((f) => h('button', {
    type: 'button', class: f === order[0] ? 'primary' : null, 'data-format': f, disabled: blocked,
    onclick: () => download(f, { type: type.value, id: id.value.trim(), bankId: bank.value.trim(), currency: cur.value.trim() || 'USD' }, bid.value.trim(), xd.value, msg),
  }, FORMATS[f].label, h('small', {}, STR.fmtNotes[f])));

  sec.replaceChildren(...clean(
    h('h2', {}, h('span', { class: 'step' }, '4'), STR.s4),
    h('div', { class: 'row' },
      h('div', { class: 'field' }, h('label', { for: 'acct-type' }, STR.acctType), type),
      h('div', { class: 'field' }, h('label', { for: 'acct-id' }, STR.acctId), id),
      h('div', { class: 'field' }, h('label', { for: 'bank-id' }, STR.bankId), bank),
      h('div', { class: 'field' }, h('label', { for: 'currency' }, STR.currency), cur)),
    h('div', { class: 'row' },
      h('div', { class: 'field' }, h('label', { for: 'intu-bid' }, STR.intuBid), bid),
      h('div', { class: 'field' }, h('label', { for: 'xero-date' }, STR.xeroDate), xd)),
    v && !v.ok ? h('p', { class: 'notice' }, STR.exportBlocked, h('br'), h('label', { class: 'check' }, force, STR.exportAnyway)) : null,
    h('div', { class: 'exports' }, buttons),
    msg,
  ));
}

function download(format, account, intuBid, xeroDateFormat, msgEl) {
  try {
    const r = exportStatement(format, {
      txns: state.txns, account, closing: state.validation?.summary.closing ?? null,
      intuBid, fid: intuBid, org: 'Statement', xeroDateFormat, baseName: state.file?.name || 'statement',
    });
    harness.emit({ type: 'done', stage: `export ${format}`, message: `${r.filename}, ${r.bytes.length} bytes` });
    const url = URL.createObjectURL(new Blob([r.bytes], { type: r.mime }));
    const a = h('a', { href: url, download: r.filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    msgEl.textContent = STR.downloaded(r.filename);
  } catch (err) {
    harness.emit({ type: 'error', stage: `export ${format}`, message: err.message });
    msgEl.textContent = err.message;
  }
}

build();
// test hook (read-only snapshot, used by the browser tests)
window.__stb = { get state() { return state; } };

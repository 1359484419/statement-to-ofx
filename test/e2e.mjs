// Browser tests with playwright-core driving an installed Chrome (or CHROME_PATH).
// Uploads real sample files through the UI, downloads every export, and writes a
// manifest for test/validate_exports.py to parse back.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startServer } from '../scripts/serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'out-e2e');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const FIX = join(here, 'fixtures');
const truth = JSON.parse(readFileSync(join(FIX, 'generated/truth.json'), 'utf8'));

const server = await startServer(0);
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const BASE = `${ORIGIN}/statement-to-ofx/`;
const executablePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath, headless: true });
const results = [];
const manifest = [];
let failed = 0;

async function newPage(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport });
  const page = await ctx.newPage();
  page.errors = [];
  page.foreign = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(ORIGIN) && !u.startsWith('blob:') && !u.startsWith('data:')) page.foreign.push(u); });
  return page;
}

async function check(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) { failed++; results.push(['FAIL', name, e.message.split('\n').slice(0, 6).join('\n')]); }
}

async function grab(page, format, outName, meta) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`button[data-format="${format}"]`)]);
  const file = join(OUT, outName);
  await dl.saveAs(file);
  const st = await page.evaluate(() => {
    const s = window.__stb.state;
    return { txns: s.txns.map((t) => ({ date: t.date, amount: t.amount, description: t.description })), closing: s.validation.summary.closing };
  });
  const sum = st.txns.reduce((a, t) => a + t.amount, 0);
  manifest.push({
    file, format, count: st.txns.length, sum, closing: st.closing ?? sum, card: !!meta.card,
    dates: st.txns.map((t) => t.date).sort(), amounts: st.txns.map((t) => t.amount),
    xeroDateFormat: meta.xeroDateFormat || 'MM/DD/YYYY',
    sample: (st.txns.find((t) => /[^\x00-\x7f]/.test(t.description)) || st.txns[0]).description,
  });
  return readFileSync(file);
}

const statText = (page, id) => page.textContent(`#${id}`);

await check('EN: CSV upload (Schwab layout) -> preset, checks, QFX + QBO + Xero exports', async () => {
  const page = await newPage();
  await page.goto(BASE);
  await page.setInputFiles('#file', join(FIX, 'csv2ofx/schwab-checking.csv'));
  await page.waitForSelector('#step3:not(.hidden)');
  assert.equal(await page.inputValue('#preset'), 'schwab-checking');
  assert.equal(await statText(page, 'stat-count'), '4');
  const checks = await page.$$eval('#checks li', (l) => l.map((x) => x.className + ':' + x.textContent));
  assert.ok(checks.every((c) => c.startsWith('ok:')), checks.join(' | '));
  await page.fill('#acct-id', '7788');
  await page.dispatchEvent('#acct-id', 'change');
  const qfx = (await grab(page, 'qfx', 'schwab.qfx', {})).toString('latin1');
  assert.match(qfx, /^OFXHEADER:100/);
  assert.match(qfx, /<INTU\.BID>3000/);
  assert.match(qfx, /<ACCTID>7788/);
  assert.equal((qfx.match(/<STMTTRN>/g) || []).length, 4);
  assert.match(qfx, /<CHECKNUM>558/);
  await grab(page, 'qbo', 'schwab.qbo', {});
  await grab(page, 'xero', 'schwab.xero.csv', {});
  assert.deepEqual(page.errors, []);
  assert.deepEqual(page.foreign, []);
});

await check('EN: text PDF (2 pages, year rollover) -> 34 rows, balance checks pass, OFX 2 export', async () => {
  const page = await newPage();
  await page.goto(BASE);
  await page.setInputFiles('#file', join(FIX, 'generated/en-checking-2page.pdf'));
  await page.waitForSelector('#step3:not(.hidden)');
  const t = truth.find((x) => x.file === 'en-checking-2page.pdf');
  assert.equal(await statText(page, 'stat-count'), String(t.txns.length));
  const checks = await page.$$eval('#checks li', (l) => l.map((x) => x.className));
  assert.deepEqual(checks, ['ok', 'ok']);
  const st = await page.evaluate(() => window.__stb.state.txns.map((x) => [x.date, x.amount]));
  assert.deepEqual(st, t.txns.map((x) => [x.date, x.amount]));
  const ofx = (await grab(page, 'ofx2', 'en-checking.ofx', {})).toString('utf8');
  assert.match(ofx, /^<\?xml/);
  assert.match(ofx, /<DTSTART>20251203<\/DTSTART>/);
  assert.match(ofx, /<DTEND>202601/);
  assert.deepEqual(page.errors, []);
  assert.deepEqual(page.foreign, []);
});

await check('EN: XLSX upload -> 15 rows, OFX 1 export', async () => {
  const page = await newPage();
  await page.goto(BASE);
  await page.setInputFiles('#file', join(FIX, 'generated/pt-extrato.xlsx'));
  await page.waitForSelector('#step3:not(.hidden)');
  assert.equal(await statText(page, 'stat-count'), '15');
  await grab(page, 'ofx1', 'xlsx.ofx', {});
  assert.deepEqual(page.errors, []);
});

await check('Review: editing an amount breaks the balance check and locks export until confirmed', async () => {
  const page = await newPage();
  await page.goto(BASE);
  await page.setInputFiles('#file', join(FIX, 'generated/br-extrato.csv'));
  await page.waitForSelector('#step3:not(.hidden)');
  const input = page.locator('#txn-table tbody tr').nth(2).locator('input.amt').first();
  await input.fill('-999.99');
  await input.dispatchEvent('change');
  await page.waitForSelector('#txn-table tr.bad');
  assert.ok(await page.isDisabled('button[data-format="qfx"]'));
  await page.check('#force-export');
  assert.ok(await page.isEnabled('button[data-format="qfx"]'));
  // delete the row again -> totals no longer match the derived closing? just make sure it re-renders
  await page.click('#txn-table tbody tr:nth-child(3) button.link');
  assert.equal(await statText(page, 'stat-count'), '11');
});

await check('Review: flip signs (card statements) negates amounts and balances', async () => {
  const page = await newPage();
  await page.goto(BASE);
  await page.setInputFiles('#file', join(FIX, 'generated/pt-extrato-dc.pdf'));
  await page.waitForSelector('#step3:not(.hidden)');
  const before = await page.evaluate(() => window.__stb.state.txns[0].amount);
  await page.check('#invert');
  const after = await page.evaluate(() => window.__stb.state.txns[0].amount);
  assert.equal(after, -before);
  const checks = await page.$$eval('#checks li', (l) => l.map((x) => x.className));
  assert.deepEqual(checks, ['ok']);
});

await check('PT: sample button (extrato CSV) -> OFX 1.0.2 in Windows-1252 with accents', async () => {
  const page = await newPage();
  await page.goto(BASE + 'pt/');
  await page.click('#sample-csv');
  await page.waitForSelector('#step3:not(.hidden)');
  assert.equal(await statText(page, 'stat-count'), '12');
  const first = await page.getAttribute('button.primary', 'data-format');
  assert.equal(first, 'ofx1');
  const buf = await grab(page, 'ofx1', 'br-extrato.ofx', {});
  assert.ok(buf.includes(Buffer.from('PADARIA S\xc3O JOS\xc9', 'latin1')), 'cp1252 accents');
  assert.match(buf.toString('latin1'), /<CURDEF>BRL/);
  await grab(page, 'xero', 'br-extrato.xero.csv', { xeroDateFormat: 'DD/MM/YYYY' });
  assert.deepEqual(page.errors, []);
  assert.deepEqual(page.foreign, []);
});

await check('PT: extrato PDF with SALDO DO DIA lines', async () => {
  const page = await newPage();
  await page.goto(BASE + 'pt/');
  await page.click('#sample-pdf');
  await page.waitForSelector('#step3:not(.hidden)');
  const t = truth.find((x) => x.file === 'pt-extrato-saldo.pdf');
  assert.equal(await statText(page, 'stat-count'), String(t.txns.length));
  const checks = await page.$$eval('#checks li', (l) => l.map((x) => x.className));
  assert.deepEqual(checks, ['ok', 'ok']);
  await grab(page, 'ofx2', 'pt-extrato.ofx', {});
});

await check('Privacy: a cross-origin fetch from the page is blocked (CSP + guard)', async () => {
  const page = await newPage();
  await page.goto(BASE);
  const r = await page.evaluate(async () => {
    try { await fetch('https://example.com/collect', { method: 'POST', body: 'x' }); return 'sent'; } catch (e) { return 'blocked: ' + e.message; }
  });
  assert.match(r, /^blocked/);
  assert.deepEqual(page.foreign, []);
});

for (const path of ['', 'pt/', 'guides/ofx-qfx-qbo.html', 'guides/xero-csv.html', 'privacy.html']) {
  await check(`Mobile 375px: /${path} has no horizontal scroll and has title/description/canonical`, async () => {
    const page = await newPage({ width: 375, height: 740 });
    await page.goto(BASE + path);
    if (path === '' || path === 'pt/') {
      await page.setInputFiles('#file', join(FIX, 'csv2ofx/schwab-checking.csv'));
      await page.waitForSelector('#step3:not(.hidden)');
    }
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
      title: document.title, desc: document.querySelector('meta[name=description]')?.content,
      canon: document.querySelector('link[rel=canonical]')?.href,
    }));
    assert.ok(m.sw <= m.cw, `scrollWidth ${m.sw} > clientWidth ${m.cw}`);
    assert.ok(m.title.length > 10 && m.title.length <= 70, 'title length ' + m.title.length);
    assert.ok(m.desc && m.desc.length > 50 && m.desc.length <= 160, 'description length ' + (m.desc || '').length);
    assert.ok(m.canon && m.canon.startsWith('https://'), 'canonical');
    assert.deepEqual(page.errors, []);
  });
}

await browser.close();
server.close();
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
for (const r of results) console.log(r[0], r[1], r[2] ? '\n   ' + r[2] : '');
console.log(`\n${results.length - failed}/${results.length} browser checks passed; ${manifest.length} downloads saved to ${OUT}`);
process.exit(failed ? 1 : 0);

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, detectDecimal, looksLikeMoney, formatCents } from '../docs/js/core/numbers.js';
import { parseDate, detectDateOrder, lacksYear } from '../docs/js/core/dates.js';
import { parseDelimited, detectDelimiter } from '../docs/js/core/csv.js';
import { validateStatement, inferSignsFromBalance } from '../docs/js/core/validate.js';
import { assignFitids, buildOfx } from '../docs/js/export/ofx.js';

test('parseAmount handles US, BR, Swiss, parentheses and D/C markers', () => {
  const cases = [
    ['$1,234.56', 123456], ['(12.00)', -1200], ['12.00-', -1200], ['-R$ 1.234,56', -123456],
    ['R$ 1.234,56', 123456], ["11'373.94", 1137394], ['1.234,56 D', -123456], ['1.234,56 C', 123456],
    ['250,00', 25000], ['0.5', 50], ['CR 5.00', 500], ['5.00DR', -500], ['-', null], ['', null], ['abc', null],
  ];
  for (const [raw, want] of cases) {
    const got = parseAmount(raw);
    let cents = got ? got.cents : null;
    if (got && got.dc === 'D') cents = -Math.abs(cents);
    assert.equal(cents, want, raw);
  }
  assert.equal(parseAmount('1.234', 'comma').cents, 123400);
  assert.equal(parseAmount('1,234', 'dot').cents, 123400);
  assert.equal(parseAmount(12.3).cents, 1230);
});

test('detectDecimal and looksLikeMoney', () => {
  assert.equal(detectDecimal(['1.234,56', '12,00', '3,10']), 'comma');
  assert.equal(detectDecimal(['1,234.56', '12.00']), 'dot');
  assert.ok(looksLikeMoney('1,234.56'));
  assert.ok(looksLikeMoney('1.234,56 D'));
  assert.ok(looksLikeMoney('(412.16)'));
  assert.ok(!looksLikeMoney('123456'));
  assert.ok(!looksLikeMoney('12/03'));
  assert.equal(formatCents(-123456), '-1,234.56');
  assert.equal(formatCents(123456, 'comma'), '1.234,56');
});

test('parseDate orders, names, serials, missing years', () => {
  assert.equal(parseDate('2/8/15', 'MDY'), '2015-02-08');
  assert.equal(parseDate('2/8/15', 'DMY'), '2015-08-02');
  assert.equal(parseDate('31.03.2019', 'DMY'), '2019-03-31');
  assert.equal(parseDate('2022-08-17'), '2022-08-17');
  assert.equal(parseDate('23-Jan-15'), '2015-01-23');
  assert.equal(parseDate('05 fev 2026', 'DMY'), '2026-02-05');
  assert.equal(parseDate('Mar 3, 2026'), '2026-03-03');
  assert.equal(parseDate('12/03', 'MDY', 2025), '2025-12-03');
  assert.equal(parseDate('31/02/2026', 'DMY'), null);
  assert.equal(parseDate(46000), '2025-12-09');
  assert.equal(detectDateOrder(['13/07', '02/07']), 'DMY');
  assert.equal(detectDateOrder(['08/17/2022', '08/14/2022']), 'MDY');
  assert.ok(lacksYear('12/03'));
  assert.ok(!lacksYear('12/03/2025'));
});

test('CSV parser: quotes, CR endings, semicolons', () => {
  const a = parseDelimited('a,b,c\r"x, y","say ""hi""",3\r');
  assert.deepEqual(a.rows, [['a', 'b', 'c'], ['x, y', 'say "hi"', '3']]);
  assert.equal(detectDelimiter('Data;Valor\n01/01/2026;1,00\n'), ';');
  assert.equal(detectDelimiter('a\tb\n1\t2\n'), '\t');
});

test('validator: running balance, totals, descending order, gaps flagged', () => {
  const asc = [
    { date: '2026-01-01', description: 'a', amount: 1000, balance: 11000 },
    { date: '2026-01-02', description: 'b', amount: -500, balance: 10500 },
    { date: '2026-01-03', description: 'c', amount: -200, balance: null },
    { date: '2026-01-04', description: 'd', amount: 100, balance: 10400 },
  ];
  const v = validateStatement(asc, { closing: 10400 });
  assert.equal(v.ok, true);
  assert.equal(v.summary.opening, 10000);
  const desc = [...asc].reverse();
  const v2 = validateStatement(desc);
  assert.equal(v2.order, 'descending');
  assert.equal(v2.ok, true);
  const broken = asc.map((t) => ({ ...t }));
  broken[1].amount = -600;
  const v3 = validateStatement(broken);
  assert.equal(v3.ok, false);
  assert.deepEqual(v3.rowIssues[1], ['balance']);
});

test('inferSignsFromBalance recovers debits', () => {
  const rows = [
    { amount: 500, balance: 9500 }, { amount: 1000, balance: 10500 }, { amount: 300, balance: 10200 },
  ];
  inferSignsFromBalance(rows, 10000);
  assert.deepEqual(rows.map((r) => r.amount), [-500, 1000, -300]);
});

test('FITIDs are stable and unique for identical rows', () => {
  const t = [
    { date: '2026-01-01', amount: -350, description: 'Coffee' },
    { date: '2026-01-01', amount: -350, description: 'Coffee' },
    { date: '2026-01-02', amount: -350, description: 'Coffee' },
  ];
  const a = assignFitids(t, '1234'), b = assignFitids(t.map((x) => ({ ...x })), '1234');
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, 3);
});

test('OFX writer escapes markup and limits NAME to 32 chars', () => {
  const txt = buildOfx({ format: 'ofx2', account: { type: 'CHECKING', id: '1' }, txns: [
    { date: '2026-01-01', amount: -100, description: 'A & B <Store> with a very long merchant name here' },
  ], now: new Date(Date.UTC(2026, 0, 2)) });
  assert.match(txt, /<NAME>A &amp; B &lt;Store&gt; with a v<\/NAME>/); // escaped length <= 32
  assert.match(txt, /<MEMO>A &amp; B &lt;Store&gt; with a very long merchant name here<\/MEMO>/);
  assert.match(txt, /<DTSERVER>20260102000000<\/DTSERVER>/);
});

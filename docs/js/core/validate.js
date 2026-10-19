// Statement checks: running-balance continuity, opening + sum = closing, bad rows, duplicates.

/**
 * @param txns [{date, description, amount(cents), balance(cents|null)}] in file order
 * @param stated { opening?: cents, closing?: cents } balances printed on the statement
 * @returns { ok, order, rowIssues: {index: [codes]}, summary, checks: [] }
 */
export function validateStatement(txns, stated = {}) {
  const rowIssues = {};
  const add = (i, code) => { (rowIssues[i] = rowIssues[i] || []).push(code); };
  const checks = [];

  // Order: compare first/last dates, fall back to counting steps.
  let asc = 0, desc = 0;
  for (let i = 1; i < txns.length; i++) {
    if (txns[i].date > txns[i - 1].date) asc++;
    else if (txns[i].date < txns[i - 1].date) desc++;
  }
  // Balance relation decides order when balances exist (dates may all be equal).
  const withBal = txns.map((t, i) => ({ t, i })).filter((x) => x.t.balance != null);
  let fwdOk = 0, revOk = 0;
  for (let k = 1; k < txns.length; k++) {
    const a = txns[k - 1], b = txns[k];
    if (a.balance == null || b.balance == null) continue;
    if (a.balance + b.amount === b.balance) fwdOk++;
    if (b.balance + a.amount === a.balance) revOk++;
  }
  let order = desc > asc ? 'descending' : 'ascending';
  if (fwdOk !== revOk && (fwdOk || revOk)) order = fwdOk > revOk ? 'ascending' : 'descending';

  const chrono = order === 'ascending' ? txns.map((t, i) => i) : txns.map((t, i) => i).reverse();

  // Running balance continuity in chronological order. Rows without a printed balance
  // (common in extratos that only print the end-of-day saldo) are carried forward.
  let balChecked = 0, balFailed = 0;
  let running = null;
  for (const idx of chrono) {
    const cur = txns[idx];
    if (running != null) running += cur.amount || 0;
    if (cur.balance != null) {
      if (running != null) {
        balChecked++;
        if (running !== cur.balance) { balFailed++; add(idx, 'balance'); }
      }
      running = cur.balance;
    }
  }

  // Row-level issues
  const seen = new Map();
  txns.forEach((t, i) => {
    if (!t.date) add(i, 'date');
    if (!t.amount) add(i, 'zero');
    if (!String(t.description || '').trim()) add(i, 'nodesc');
    const key = `${t.date}|${t.amount}|${String(t.description).toLowerCase().trim()}`;
    if (seen.has(key)) add(i, 'duplicate'); else seen.set(key, i);
  });
  if (order === 'ascending') {
    for (let i = 1; i < txns.length; i++) if (txns[i].date < txns[i - 1].date) add(i, 'order');
  }

  const sum = txns.reduce((a, t) => a + (t.amount || 0), 0);
  const credits = txns.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0);
  const debits = txns.filter((t) => t.amount < 0).reduce((a, t) => a + t.amount, 0);

  // Opening / closing: stated values win, otherwise derive from running balance.
  let opening = stated.opening ?? null, closing = stated.closing ?? null;
  let derivedOpening = null, derivedClosing = null;
  {
    let cum = 0;
    for (const idx of chrono) {
      cum += txns[idx].amount || 0;
      if (txns[idx].balance != null) { derivedOpening = txns[idx].balance - cum; break; }
    }
    let after = 0;
    for (let k = chrono.length - 1; k >= 0; k--) {
      const t = txns[chrono[k]];
      if (t.balance != null) { derivedClosing = t.balance + after; break; }
      after += t.amount || 0;
    }
  }
  if (opening == null) opening = derivedOpening;
  if (closing == null) closing = derivedClosing;

  if (balChecked) checks.push({ id: 'running', ok: balFailed === 0, checked: balChecked, failed: balFailed });
  let totalsOk = null;
  if (opening != null && closing != null) {
    totalsOk = opening + sum === closing;
    checks.push({ id: 'totals', ok: totalsOk, opening, sum, closing, diff: closing - (opening + sum) });
  }
  if (stated.closing != null && derivedClosing != null && stated.closing !== derivedClosing) {
    checks.push({ id: 'stated-closing', ok: false, stated: stated.closing, derived: derivedClosing });
  }
  const hardFail = checks.some((c) => !c.ok);
  const dates = txns.map((t) => t.date).filter(Boolean).sort();
  return {
    ok: !hardFail && !Object.values(rowIssues).some((l) => l.some((c) => c === 'date' || c === 'balance')),
    order,
    rowIssues,
    checks,
    summary: {
      count: txns.length, credits, debits, sum, opening, closing,
      start: dates[0] || null, end: dates[dates.length - 1] || null,
      balanceRows: withBal.length,
    },
  };
}

/**
 * Sign repair: when amounts are unsigned but balances exist, flip each amount so
 * prev balance + amount = balance. Returns number of rows flipped.
 */
export function inferSignsFromBalance(txns, opening = null) {
  let flipped = 0;
  let prev = opening;
  for (const t of txns) {
    if (t.balance != null && prev != null) {
      const a = Math.abs(t.amount);
      if (prev + a === t.balance) { if (t.amount !== a) { t.amount = a; flipped++; } }
      else if (prev - a === t.balance) { if (t.amount !== -a) { t.amount = -a; flipped++; } }
    }
    if (t.balance != null) prev = t.balance; else if (prev != null) prev += t.amount;
  }
  return flipped;
}

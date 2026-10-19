// Harness: runs each conversion stage with timing, error capture and an event log,
// and enforces the "nothing leaves the browser" policy. Core modules stay pure.

export function createHarness({ onEvent = () => {}, maxBytes = 50 * 1024 * 1024 } = {}) {
  const log = [];
  const emit = (ev) => { const e = { t: Date.now(), ...ev }; log.push(e); onEvent(e); return e; };

  async function stage(name, fn) {
    const t0 = (globalThis.performance || Date).now();
    emit({ type: 'start', stage: name });
    try {
      const out = await fn();
      emit({ type: 'done', stage: name, ms: Math.round((globalThis.performance || Date).now() - t0) });
      return out;
    } catch (err) {
      emit({ type: 'error', stage: name, message: String(err && err.message || err) });
      throw err;
    }
  }

  function checkInput(file) {
    if (file.size > maxBytes) throw new Error(`File too large (${Math.round(file.size / 1048576)} MB). Limit is ${maxBytes / 1048576} MB.`);
    const name = (file.name || '').toLowerCase();
    const kind = name.endsWith('.pdf') ? 'pdf'
      : /\.(xlsx|xlsm|xls|ods)$/.test(name) ? 'sheet'
      : /\.(csv|tsv|txt)$/.test(name) ? 'text' : null;
    if (!kind) throw new Error('Unsupported file type. Use CSV, TSV, TXT, XLSX, XLS or a text-based PDF.');
    return kind;
  }

  return { stage, emit, checkInput, log };
}

/**
 * Browser-only guard: block any fetch/XHR/beacon to another origin. The page also ships a
 * Content-Security-Policy with connect-src 'self', so this is defense in depth and gives a
 * visible log entry if a library ever tries to phone home.
 */
export function installNetworkGuard(onBlocked = () => {}) {
  if (typeof window === 'undefined') return;
  const same = (u) => { try { return new URL(u, location.href).origin === location.origin; } catch { return false; } };
  const of = window.fetch;
  if (of) {
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input && input.url;
      if (url && !same(url) && !String(url).startsWith('blob:') && !String(url).startsWith('data:')) {
        onBlocked(url);
        return Promise.reject(new Error('Blocked network request: ' + url));
      }
      return of.call(this, input, init);
    };
  }
  const xo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (!same(url) && !String(url).startsWith('blob:')) { onBlocked(url); throw new Error('Blocked network request: ' + url); }
    return xo.call(this, method, url, ...rest);
  };
  if (navigator.sendBeacon) navigator.sendBeacon = (url) => { onBlocked(url); return false; };
}

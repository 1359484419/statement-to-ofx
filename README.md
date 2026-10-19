# Statement Bridge (statement-to-ofx)

Convert bank statements to **OFX 2.2, OFX 1.0.2, QFX, QBO or Xero CSV** entirely in the browser.
Input: CSV/TSV/TXT from any bank (column wizard + a few recognised layouts), XLSX/XLS/ODS, and
text-based PDF statements (PDF.js text extraction + a generic table heuristic). English site at `/`,
Brazilian Portuguese “extrato → OFX” page at `/pt/`.

## Privacy

- Files are read with the browser File API and parsed in the tab. Nothing is uploaded; there is no backend.
- Every page sends a Content-Security-Policy limiting scripts and connections to the site itself, and
  `js/core/harness.js` also blocks cross-origin fetch/XHR/beacon calls and logs any attempt.
- No analytics or third-party scripts. PDF.js (Apache-2.0) and SheetJS CE (Apache-2.0) are vendored in `docs/vendor/`.
- Only export preferences (account type/number, bank ID, currency, INTU.BID, Xero date format) go to `localStorage`.

## What it does

1. **Load**: CSV/TSV/TXT (delimiter, BOM, CR/LF/CRLF, UTF-8 or Windows-1252 auto-detected), spreadsheets, text PDFs (password prompt supported).
2. **Map** (tabular): header-row detection, column role guessing (date, description, memo, signed amount, debit/credit, balance, D/C flag, check number, reference), date order MDY/DMY/YMD, decimal dot/comma, sign flip. Presets for layouts seen in public sample files: Capital One card, Schwab checking, Mint export, Payoneer, N26, UBS (FR).
3. **PDF heuristic**: rebuilds lines from positioned text, recognises header rows (Date/Description/Withdrawals/Deposits/Amount/Balance, Data/Histórico/Documento/Valor/Saldo), date-led rows, multi-line descriptions, opening/closing balance lines, `SALDO DO DIA` rows, D/C suffixes and trailing minus signs, years missing from dates (year from the statement period, Dec→Jan rollover), and recovers signs from the balance column when amounts are unsigned.
   It is **not** a set of per-bank templates; no specific bank's PDF layout is claimed as supported.
4. **Review**: editable table; running-balance continuity (ascending or newest-first; rows without a printed balance are carried), opening + sum = closing, bad dates, zero amounts, duplicates. Export is locked while checks fail unless the user confirms.
5. **Export**: stable FITIDs (FNV-1a over date, amount, description, occurrence #), NAME ≤ 32 chars with full text in MEMO, bank or credit-card aggregates, LEDGERBAL from the statement. OFX 1.0.2/QFX/QBO are encoded as Windows-1252; OFX 2.2 is ASCII with XML character references. QFX/QBO include `INTU.BID` (user editable, marked experimental).

## Run locally

```sh
npm install          # dev tools only: pdfjs-dist, xlsx, pdf-lib, playwright-core
npm run serve        # http://127.0.0.1:8080/statement-to-ofx/
```

The site is plain static files in `docs/` (ES modules, no build step), ready for GitHub Pages with `docs/` as the source.
Any static server works; opening `index.html` from `file://` does not, because browsers block ES module imports there.

## Tests

```sh
python3 -m venv .venv && .venv/bin/pip install ofxparse ofxtools
npm run fetch-samples                     # optional: third-party PDF sample (AGPL, not committed)
OFX_PYTHON=.venv/bin/python npm test
```

`npm test` runs:

- `test/core.test.mjs`: unit tests (amounts, dates, CSV, validator, FITIDs, OFX escaping).
- `test/pipeline.test.mjs`: every sample file → parse → validate → all 5 formats into `test/out/`.
  Samples: 10 CSVs from csv2ofx's MIT test data (`test/fixtures/csv2ofx/`), generated fixtures with known ground truth
  (`scripts/make-fixtures.mjs`: 4 PDFs incl. a 2-page statement crossing a year, a Portuguese extrato with
  SALDO DO DIA rows, a D/C-suffix extrato and an unsigned-amount statement; one XLSX; one Brazilian CSV), and
  optionally the monopoly project's example credit-card PDF.
- `test/validate_exports.py`: reads every OFX/QFX/QBO back with **ofxparse** and **ofxtools** (count, sum,
  dates, amounts, unique FITIDs, ledger balance, account type, text round-trip) and every Xero CSV with Python's `csv`.
- `test/e2e.mjs`: Chrome via playwright-core (`CHROME_PATH` to override): uploads files through the UI, edits rows,
  flips signs, downloads each format, checks that no request leaves the origin, and checks 375 px layouts plus
  title/description/canonical on all pages. Downloads are then read back by the Python validator.

## Known limits

- Scanned (image) PDFs: no OCR yet.
- PDF parsing is heuristic and was verified only on the generated fixtures and one public sample statement.
- QFX/QBO acceptance depends on the INTU.BID the importing program accepts; not tested in Quicken or QuickBooks themselves.
- No QIF output, no batch mode, no splitting of large files yet (planned for a future Pro tier; nothing is sold today).

## Trademarks

Quicken is a trademark of Quicken Inc.; QuickBooks and Intuit are trademarks of Intuit Inc.; Xero is a trademark of
Xero Limited. They are named only to describe file compatibility. This project is not affiliated with or endorsed by them.

## License

MIT, see `LICENSE`. Vendored libraries keep their own licenses (`docs/vendor/*/LICENSE`).
Test CSVs in `test/fixtures/csv2ofx/` come from csv2ofx (MIT), see `SOURCE.md` there.

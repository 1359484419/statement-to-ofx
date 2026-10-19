"""Read every exported file back with independent parsers.

OFX / QFX / QBO: ofxparse (lenient, widely used) and ofxtools (strict, schema-validating).
Xero CSV: Python's csv module, header + amounts + date format.

Usage: python validate_exports.py test/out/manifest.json
"""
import csv
import io
import json
import sys
import unicodedata
import warnings
from datetime import datetime
from decimal import Decimal

import ofxparse
from bs4 import XMLParsedAsHTMLWarning

warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)
from ofxtools.Parser import OFXTree


def cents(d):
    return int((Decimal(str(d)) * 100).to_integral_value())


def cp1252_fallback(s):
    """Mirror of the writer's lossy cp1252 mapping: keep cp1252 chars, strip accents, else '?'."""
    out = []
    for ch in s:
        try:
            ch.encode("cp1252")
            out.append(ch)
        except UnicodeEncodeError:
            base = "".join(c for c in unicodedata.normalize("NFD", ch) if not unicodedata.combining(c))
            try:
                base.encode("cp1252")
                out.append(base if len(base) == 1 else "?")
            except UnicodeEncodeError:
                out.append("?")
    return "".join(out)


def check_ofx(entry, failures):
    path = entry["file"]
    raw = open(path, "rb").read()
    fmt = entry["format"]
    # Encoding: SGML variants are cp1252, XML is UTF-8. The sample description must survive.
    text = raw.decode("utf-8" if fmt == "ofx2" else "cp1252")
    if fmt in ("qfx", "qbo") and "<INTU.BID>3000" not in text:
        failures.append(f"{path}: missing INTU.BID")
    if fmt == "ofx2" and not text.startswith("<?xml"):
        failures.append(f"{path}: OFX2 must start with XML declaration")

    # --- ofxparse
    ofx = ofxparse.OfxParser.parse(io.BytesIO(raw))
    acct = ofx.account
    txs = acct.statement.transactions
    if len(txs) != entry["count"]:
        failures.append(f"{path}: ofxparse count {len(txs)} != {entry['count']}")
    total = sum(cents(t.amount) for t in txs)
    if total != entry["sum"]:
        failures.append(f"{path}: ofxparse sum {total} != {entry['sum']}")
    if sorted(cents(t.amount) for t in txs) != sorted(entry["amounts"]):
        failures.append(f"{path}: ofxparse amounts differ")
    got_dates = sorted(t.date.strftime("%Y-%m-%d") for t in txs)
    if got_dates != entry["dates"]:
        failures.append(f"{path}: ofxparse dates differ")
    ids = [t.id for t in txs]
    if len(set(ids)) != len(ids):
        failures.append(f"{path}: duplicate FITIDs")
    if cents(acct.statement.balance) != entry["closing"]:
        failures.append(f"{path}: ledger balance {acct.statement.balance} != {entry['closing']}")
    names = " ".join((t.payee or "") + " " + (t.memo or "") for t in txs)
    probe = entry["sample"][:20]
    if fmt != "ofx2":
        probe = cp1252_fallback(probe)
    if probe and probe not in names:
        failures.append(f"{path}: text {probe!r} lost in round trip")

    # --- ofxtools (strict). It does not know Intuit's INTU.BID extension, so strip it,
    # which is what Intuit-aware readers do as well.
    clean = raw
    if fmt in ("qfx", "qbo"):
        clean = b"\r\n".join(l for l in raw.split(b"\r\n") if not l.startswith(b"<INTU.BID>"))
    tree = OFXTree()
    tree.parse(io.BytesIO(clean))
    model = tree.convert()
    stmt = model.statements[0]
    n = len(stmt.banktranlist)
    if n != entry["count"]:
        failures.append(f"{path}: ofxtools count {n} != {entry['count']}")
    s2 = sum(cents(t.trnamt) for t in stmt.banktranlist)
    if s2 != entry["sum"]:
        failures.append(f"{path}: ofxtools sum {s2} != {entry['sum']}")
    kind = type(stmt).__name__
    if entry["card"] and kind != "CCSTMTRS":
        failures.append(f"{path}: expected credit card statement, got {kind}")
    if not entry["card"] and kind != "STMTRS":
        failures.append(f"{path}: expected bank statement, got {kind}")


def check_xero(entry, failures):
    path = entry["file"]
    text = open(path, encoding="utf-8").read()
    rows = list(csv.reader(io.StringIO(text)))
    head = rows[0]
    if head[:2] != ["*Date", "*Amount"]:
        failures.append(f"{path}: bad header {head}")
    body = rows[1:]
    if len(body) != entry["count"]:
        failures.append(f"{path}: xero rows {len(body)} != {entry['count']}")
    fmt = {"MM/DD/YYYY": "%m/%d/%Y", "DD/MM/YYYY": "%d/%m/%Y", "YYYY-MM-DD": "%Y-%m-%d"}[entry["xeroDateFormat"]]
    dates = sorted(datetime.strptime(r[0], fmt).strftime("%Y-%m-%d") for r in body)
    if dates != entry["dates"]:
        failures.append(f"{path}: xero dates differ")
    total = sum(cents(r[1]) for r in body)
    if total != entry["sum"]:
        failures.append(f"{path}: xero sum {total} != {entry['sum']}")
    if any("," in r[1] for r in body):
        failures.append(f"{path}: amounts must not contain thousands separators")


def main():
    manifest = json.load(open(sys.argv[1]))
    failures = []
    counts = {}
    for e in manifest:
        try:
            if e["format"] == "xero":
                check_xero(e, failures)
            else:
                check_ofx(e, failures)
        except Exception as exc:  # parser rejected the file
            failures.append(f"{e['file']}: {type(exc).__name__}: {exc}")
        counts[e["format"]] = counts.get(e["format"], 0) + 1
    print(f"checked {len(manifest)} files: {counts}")
    for f in failures:
        print("FAIL", f)
    if failures:
        sys.exit(1)
    print("all exports parsed back by ofxparse + ofxtools / csv: OK")


if __name__ == "__main__":
    main()

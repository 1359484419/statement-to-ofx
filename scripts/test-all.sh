#!/bin/sh
# Full test run: unit + pipeline tests (Node), read-back of every export with
# ofxparse/ofxtools (Python), browser tests (Chrome), read-back of browser downloads.
# OFX_PYTHON: a python with `ofxparse ofxtools` installed (default: python3).
set -eu
cd "$(dirname "$0")/.."
PY="${OFX_PYTHON:-python3}"
echo "== node unit + pipeline tests"
node --test test/*.test.mjs
echo "== python read-back of pipeline exports"
"$PY" -I test/validate_exports.py test/out/manifest.json
echo "== browser tests"
node test/e2e.mjs
echo "== python read-back of browser downloads"
"$PY" -I test/validate_exports.py test/out-e2e/manifest.json

#!/bin/sh
# Downloads third-party sample statements used by optional tests. They are NOT committed
# (different licenses). Files are only read as data.
set -eu
cd "$(dirname "$0")/../test"
mkdir -p external
[ -f external/monopoly_example_statement.pdf ] || curl -fsSL --max-time 60 \
  -o external/monopoly_example_statement.pdf \
  https://raw.githubusercontent.com/benjamin-awd/monopoly/main/src/monopoly/examples/example_statement.pdf
echo "ok: $(ls external)"

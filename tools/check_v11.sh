#!/usr/bin/env bash
set -euo pipefail
node tools/build_v11.mjs
node --check SuperAgent_V11_FULL.js
bytes=$(wc -c < SuperAgent_V11_FULL.js)
lines=$(wc -l < SuperAgent_V11_FULL.js)
test "$bytes" -gt 380000
test "$lines" -gt 14000
echo "V11 local builder checks PASS: bytes=$bytes lines=$lines"

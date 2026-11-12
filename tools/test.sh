#!/usr/bin/env bash
# ============================================================
# test.sh — run the portable-math self-test and syntax check.
#
# Uses Node.js when installed, otherwise the `jsc` shell that ships with
# macOS (no install needed). selftest.js checks plain-JS syntax and the
# math block; smoketest.js runs the whole script against a FAKE PixInsight.
# Neither proves the GUI / process calls work — only PixInsight can.
#
# Usage:  tools/test.sh
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

JSC="/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"

if command -v node >/dev/null 2>&1; then
   echo "runtime: node $(node --version)"
   node tools/selftest.js
   node tools/smoketest.js
elif [ -x "${JSC}" ]; then
   echo "runtime: macOS jsc"
   "${JSC}" tools/selftest.js
   "${JSC}" tools/smoketest.js
else
   echo "No JavaScript runtime found: install Node.js, or run on macOS (jsc)." >&2
   exit 2
fi

#!/usr/bin/env bash
# ============================================================
# build-package.sh — build the PixInsight update package.
#
# Zips the installable tree (src/scripts/*) into
# repository/ObstructionCorrection-<version>.zip and prints the sha1 and
# byte size to paste into repository/updates.xri (added at release time).
#
# Usage:  tools/build-package.sh <version>      e.g. 0.1.0
# ============================================================
set -euo pipefail

if [ $# -lt 1 ]; then
   echo "Usage: tools/build-package.sh <version>" >&2
   exit 2
fi

VERSION="$1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG_NAME="ObstructionCorrection-${VERSION}.zip"
OUT="${ROOT}/repository/${PKG_NAME}"

cd "${ROOT}"
tools/test.sh >/dev/null || { echo "Self-test failed — not packaging." >&2; exit 1; }
mkdir -p repository

# Internal paths mirror PixInsight's install tree: src/scripts/<ScriptName>/
rm -f "${OUT}"
zip -r -X "${OUT}" src/scripts -x '*.DS_Store' >/dev/null

if command -v sha1sum >/dev/null 2>&1; then
   SHA1="$(sha1sum "${OUT}" | awk '{print $1}')"
else
   SHA1="$(shasum -a 1 "${OUT}" | awk '{print $1}')"   # macOS
fi
SIZE="$(wc -c < "${OUT}" | tr -d ' ')"

echo "Built : repository/${PKG_NAME}"
echo "sha1  : ${SHA1}"
echo "size  : ${SIZE} bytes"
echo "date  : $(date -u +%Y%m%d)  (releaseDate for updates.xri)"

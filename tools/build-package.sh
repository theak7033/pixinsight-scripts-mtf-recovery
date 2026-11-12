#!/usr/bin/env bash
# ============================================================
# build-package.sh — build the PixInsight update package.
#
# Zips the installable tree (src/scripts/*) into
# repository/ObstructionCorrection-<version>.zip and writes its file name,
# sha1 and release date into repository/updates.xri, so the manifest always
# matches the package. Older ObstructionCorrection-*.zip files are removed.
#
# Uses `zip` when installed, otherwise Python's zipfile module (Git Bash on
# Windows has no zip).
#
# Usage:  tools/build-package.sh <version>      e.g. 0.1.0
# Then commit repository/ and push: PixInsight users get the update from
#   https://raw.githubusercontent.com/theak7033/pixinsight-scripts-mtf-recovery/main/repository/
# ============================================================
set -euo pipefail

if [ $# -lt 1 ]; then
   echo "Usage: tools/build-package.sh <version>" >&2
   exit 2
fi

VERSION="$1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG_NAME="ObstructionCorrection-${VERSION}.zip"
OUT="repository/${PKG_NAME}"           # relative: native Windows tools can't read /e/... paths
XRI="repository/updates.xri"

cd "${ROOT}"
tools/test.sh >/dev/null || { echo "Self-test failed — not packaging." >&2; exit 1; }
[ -f "${XRI}" ] || { echo "Missing ${XRI}." >&2; exit 1; }
mkdir -p repository

# Internal paths mirror PixInsight's install tree: src/scripts/<ScriptName>/
rm -f repository/ObstructionCorrection-*.zip
if command -v zip >/dev/null 2>&1; then
   zip -r -X "${OUT}" src/scripts -x '*.DS_Store' >/dev/null
else
   PY=""
   for c in python python3; do
      if command -v "$c" >/dev/null 2>&1 && "$c" -c "import zipfile" >/dev/null 2>&1; then PY="$c"; break; fi
   done
   [ -n "${PY}" ] || { echo "Need zip or Python to build the package." >&2; exit 2; }
   "${PY}" -I - "${OUT}" <<'PY'
import os, sys, zipfile
out = sys.argv[1]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk("src/scripts"):
        dirs.sort()
        z.write(root, root.replace(os.sep, "/") + "/")          # directory entry, as zip -r makes
        for f in sorted(files):
            if f == ".DS_Store":
                continue
            p = os.path.join(root, f)
            z.write(p, p.replace(os.sep, "/"))
PY
fi

if command -v sha1sum >/dev/null 2>&1; then
   SHA1="$(sha1sum "${OUT}" | awk '{print $1}')"
else
   SHA1="$(shasum -a 1 "${OUT}" | awk '{print $1}')"   # macOS
fi
SIZE="$(wc -c < "${OUT}" | tr -d ' ')"
DATE="$(date -u +%Y%m%d)"

# Point the manifest at the new package. PixInsight offers an update only
# when fileName / releaseDate change, which a new version always does.
sed -i.bak -E \
   -e "s/fileName=\"[^\"]*\"/fileName=\"${PKG_NAME}\"/" \
   -e "s/sha1=\"[^\"]*\"/sha1=\"${SHA1}\"/" \
   -e "s/releaseDate=\"[^\"]*\"/releaseDate=\"${DATE}\"/" \
   -e "s#<title>ObstructionCorrection [^<]*</title>#<title>ObstructionCorrection ${VERSION}</title>#" \
   "${XRI}"
rm -f "${XRI}.bak"

echo "Built   : ${OUT}"
echo "sha1    : ${SHA1}"
echo "size    : ${SIZE} bytes"
echo "date    : ${DATE}"
echo "Updated : ${XRI}  (fileName, sha1, releaseDate, title)"
echo "Next    : commit repository/ and push to main."

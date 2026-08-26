#!/usr/bin/env bash
# Rebuild the live radiotests.org branch from the production branch.
#
#   PARC_PASSCODE=... ./tools/sync-live-branch.sh
#
# The two branches must differ in exactly two ways: the CNAME file, and the
# SITE_ORIGIN the build is run with. Everything else is identical.
#
# This exists because doing it by hand went wrong twice. Copying only
# `tools css js` left pages/ behind, so a label edited on the production branch
# never reached the live site; and running `git checkout <branch> -- ...` over an
# uncommitted tree silently discarded work in progress. Both are avoided here:
# the tree must be clean before anything happens, and every source path is
# copied, not a hand-picked subset.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC_BRANCH="facelift-and-ve-lock"
LIVE_BRANCH="gh-pages-preview"
LIVE_DOMAIN="radiotests.org"

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean. Commit or stash first —"
  echo "this script overwrites files from $SRC_BRANCH and would discard them."
  git status --short | sed 's/^/  /'
  exit 1
fi

if [ -z "${PARC_PASSCODE:-}" ]; then
  echo "PARC_PASSCODE is not set; the VE pages could not be re-encrypted."
  echo "Set it so the locked pages are rebuilt from _ve-source/."
  exit 1
fi

echo "Syncing $LIVE_BRANCH from $SRC_BRANCH …"
git checkout -q "$LIVE_BRANCH"

# Everything except CNAME, which is the one file that must differ.
git checkout "$SRC_BRANCH" -- .
echo "$LIVE_DOMAIN" > CNAME

WEAK=""
[ "${#PARC_PASSCODE}" -lt 8 ] && WEAK="--allow-weak"

SITE_ORIGIN="https://$LIVE_DOMAIN" node tools/retheme.mjs >/dev/null
node tools/fix-alt.mjs >/dev/null
SITE_ORIGIN="https://$LIVE_DOMAIN" node tools/build-seo.mjs >/dev/null
SITE_ORIGIN="https://$LIVE_DOMAIN" node tools/parc-lock.mjs $WEAK >/dev/null

echo
echo "  CNAME      : $(cat CNAME)"
echo "  canonical  : $(grep -o 'canonical" href="https://[^/]*' index.html | sed 's/.*href="//')"
echo "  VE payloads: $(grep -l 've-payload' pages/*.html | wc -l)/18"
echo "  tracked _ve-source: $(git ls-files | grep -c '^_ve-source/' || true)"
echo
echo "Review, then:  git add -A && git commit && git push origin $LIVE_BRANCH"

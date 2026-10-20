#!/bin/sh
# Fail the build when the committed game bundle is older than the sources
# it is built from.
#
# The docker image ships the committed web/xgalaga.js (the image build has
# no emsdk), so a source change that is committed without rebuilding the
# bundle would silently ship the old game.  This compares git commit
# timestamps: the bundle must not be older than any of its inputs.
#
# Usage: .github/scripts/check-bundle-freshness.sh
set -e

BUNDLE=web/xgalaga.js

if [ ! -f "$BUNDLE" ]; then
    echo "::error::$BUNDLE is missing - run ./build.sh and commit the result"
    exit 1
fi

# Everything ./build.sh reads (directly or through the patched sources).
SOURCES="build.sh
webglue.js
wlib_web.c
sound_web.c
frate_web.c
joystick_web.c
leaderboard_web.c
config.h
fontdata.h
bigfontdata.h
hudicons.h
sounddata.h
CREDITS
mkbigfont.py
mkhudicons.py
mksounddata.py
patches
xgalaga-2.1.1.0"

# The commit that last touched the bundle.
bundle_ts=$(git log -1 --format=%ct -- "$BUNDLE")
if [ -z "$bundle_ts" ]; then
    echo "::error::cannot read the git history of $BUNDLE"
    exit 1
fi

stale=""
for f in $SOURCES; do
    [ -e "$f" ] || continue
    ts=$(git log -1 --format=%ct -- "$f")
    [ -n "$ts" ] || continue
    if [ "$ts" -gt "$bundle_ts" ]; then
        stale="$stale $f"
    fi
done

if [ -n "$stale" ]; then
    echo "::error::$BUNDLE is older than:$stale"
    echo ""
    echo "The docker image ships the committed bundle, so it would contain the"
    echo "old game.  Rebuild it (needs emsdk) and commit the result:"
    echo ""
    echo "    ./build.sh"
    echo "    git add $BUNDLE"
    echo "    git commit -m 'Rebuild the game bundle'"
    exit 1
fi

echo "$BUNDLE is up to date (last changed in commit $(git log -1 --format=%h -- "$BUNDLE"))."

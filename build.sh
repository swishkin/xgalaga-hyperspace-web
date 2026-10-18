#!/bin/sh
# Build xgalaga-hyperspace for the browser (Emscripten/WebAssembly).
#
# Produces xgalaga.js (self-contained: wasm + level data inlined) at the
# repo root, to be served or opened together with index.html.
#
# The pristine 2.1.1.0 source tree in xgalaga-2.1.1.0/ is never modified:
# the build stages a throwaway copy and applies patches/0001-web-port.patch
# (60 Hz retime, MINTORPS floors, web input fixes) and
# patches/0002-debug-webui.patch (in-game equipment indicators, debug panel
# C bridge) to that copy.
#
# Requires: emsdk on $HOME/emsdk, python3, and a working `patch`.
# The bitmap font (fontdata.h) is static: it is the classic X 6x13 core
# font as rendered by an X server.
set -e
cd "$(dirname "$0")"
REPO=$(pwd)

. "$HOME/emsdk/emsdk_env.sh" >/dev/null 2>&1

GAME=xgalaga-2.1.1.0
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Stage a throwaway copy of the pristine tree and apply the web patches.
cp -r "$GAME" "$STAGE/$GAME"
( cd "$STAGE" && patch -p1 -s < "$REPO/patches/0001-web-port.patch" && \
  patch -p1 -s < "$REPO/patches/0002-debug-webui.patch" )

# Generated data (kept in the tree; regenerated on each build)
python3 mksounddata.py sounddata.h

# Debug panel (debug_webui.js + the xgal_web_debug_* C bridge in main.c):
# opt-in, so the shipped game cannot be used to farm scores with the
# powerup setters.  Build with:  XGAL_DEBUG_PANEL=true ./build.sh
DEBUG_DEFINE=
DEBUG_EXPORTS=
if [ "${XGAL_DEBUG_PANEL:-}" = "true" ]; then
    DEBUG_DEFINE="-DXGAL_DEBUG_WEBUI"
    DEBUG_EXPORTS=",'_xgal_web_debug_state','_xgal_web_debug_set_start_level','_xgal_web_debug_start_game','_xgal_web_debug_set_weapon','_xgal_web_debug_set_maxtorps','_xgal_web_debug_set_ships','_xgal_web_debug_set_shields','_xgal_web_debug_set_speed','_xgal_web_debug_set_paused'"
fi

# xgalaga-hyperspace = sources compiled WITHOUT -DORIGINAL_XGALAGA.
# The X11 libsprite is replaced by the web backends at the repo root:
#   wlib_web.c      Wlib windowing on an HTML canvas (framebuffer backend)
#   sound_web.c     Web Audio sound (replaces sound.c's forked sound server)
#   frate_web.c     emscripten_sleep frame pacing (replaces frate.c's SIGALRM)
#   joystick_web.c  no-op joystick (replaces linux-joystick.c, __linux__-gated)
#   leaderboard_web.c shared high-score leaderboard bridge (submit + refresh)
#
# ASYNCIFY lets the blocking game loop yield to the browser's event loop
# via emscripten_sleep() (see frate_web.c).  EXIT_RUNTIME makes quit keys
# (Q) freeze the page instead of navigating away.  SINGLE_FILE inlines the
# wasm so the whole game is one .js file.
emcc -O2 -UORIGINAL_XGALAGA $DEBUG_DEFINE \
    -I. -I"$STAGE/$GAME" \
    "$STAGE/$GAME"/main.c "$STAGE/$GAME"/data.c "$STAGE/$GAME"/paths.c \
    "$STAGE/$GAME"/pathfile.c "$STAGE/$GAME"/title.c "$STAGE/$GAME"/explosions.c \
    "$STAGE/$GAME"/score.c "$STAGE/$GAME"/highscore.c "$STAGE/$GAME"/prize.c \
    "$STAGE/$GAME"/images.c \
    wlib_web.c sound_web.c frate_web.c joystick_web.c leaderboard_web.c \
    --embed-file "$STAGE/$GAME/levels"@/levels \
    --embed-file CREDITS@/tmp/xgal_credits \
    -s ASYNCIFY=1 \
    -s EXIT_RUNTIME=1 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s SINGLE_FILE=1 \
    -s EXPORTED_RUNTIME_METHODS=['HEAPU8'] \
    -s EXPORTED_FUNCTIONS=['_main','_xgal_web_refresh','_xgal_web_getting_name'$DEBUG_EXPORTS,'_malloc'] \
    -o xgalaga.js
# Inline webglue.js (input bridge) at the front of the bundle: the deliverable
# is a single file, and one script tag avoids a browser cache desync between
# two separately-cached scripts.  webglue.js is a self-contained IIFE that
# must load before the emscripten module initializes.
cat webglue.js xgalaga.js > .xgalaga.tmp && mv .xgalaga.tmp xgalaga.js
echo "Built: xgalaga.js (serve the repo root and open index.html)"

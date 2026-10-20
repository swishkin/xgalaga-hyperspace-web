#!/bin/sh
# Build xgalaga-hyperspace for the browser (Emscripten/WebAssembly).
#
# Produces web/xgalaga.js (self-contained: wasm + level data inlined) in
# the repo's web/ directory, to be served or opened together with
# web/index.html.  web/ holds exactly the files the server hands out;
# everything else in the repo (the C sources, the upstream tree, the
# patches, .git, .env) stays outside the served directory.
#
# The pristine 2.1.1.0 source tree in xgalaga-2.1.1.0/ is never modified:
# the build stages a throwaway copy and applies patches/0001-web-port.patch
# (60 Hz retime, MINTORPS floors, web input fixes),
# patches/0002-debug-webui.patch (in-game equipment indicators, debug panel
# C bridge), patches/0003-score-name-terminator.patch (NUL-terminate the
# score-record name field) and patches/0004-new-game-unpaused.patch (a new
# game always starts unpaused) to that copy.
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
  patch -p1 -s < "$REPO/patches/0002-debug-webui.patch" && \
  patch -p1 -s < "$REPO/patches/0003-score-name-terminator.patch" && \
  patch -p1 -s < "$REPO/patches/0004-new-game-unpaused.patch" )

# Generated data (kept in the tree; regenerated on each build)
python3 mksounddata.py sounddata.h

# Debug panel (debug_webui.js + the xgal_web_debug_* C bridge in main.c).
#
# The bridge is COMPILED IN BY DEFAULT, so one artifact serves both cases:
# the panel's visibility is a *runtime* switch, not a build-time one.
# leaderboard.py reads the XGAL_DEBUG_PANEL environment variable and
# tells the page whether to show the panel (default: off), which is how
# the docker deployment turns it on:
#
#     docker run -e XGAL_DEBUG_PANEL=true ...
#
# Build-time opt-out (for an artifact that must not contain the panel
# code at all):
#
#     XGAL_DEBUG_PANEL=false ./build.sh
#
# XGAL_DEBUG_PANEL=true is still accepted (same as the default) so
# existing invocations keep working.
DEBUG_DEFINE="-DXGAL_DEBUG_WEBUI"
DEBUG_EXPORTS=",'_xgal_web_debug_state','_xgal_web_debug_set_start_level','_xgal_web_debug_start_game','_xgal_web_debug_set_weapon','_xgal_web_debug_set_maxtorps','_xgal_web_debug_set_ships','_xgal_web_debug_set_shields','_xgal_web_debug_set_speed','_xgal_web_debug_set_paused'"
case "$(printf '%s' "${XGAL_DEBUG_PANEL:-true}" | tr '[:upper:]' '[:lower:]')" in
    false|0|no|off)
        DEBUG_DEFINE=
        DEBUG_EXPORTS=
        ;;
esac

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
    -s EXPORTED_FUNCTIONS=['_main','_xgal_web_refresh','_xgal_web_getting_name','_xgal_web_set_keymap','_xgal_web_set_paused'$DEBUG_EXPORTS,'_malloc'] \
    -o "$REPO/web/xgalaga.js"
# Inline webglue.js (input bridge) at the front of the bundle: the deliverable
# is a single file, and one script tag avoids a browser cache desync between
# two separately-cached scripts.  webglue.js is a self-contained IIFE that
# must load before the emscripten module initializes.
cat webglue.js web/xgalaga.js > .xgalaga.tmp && mv .xgalaga.tmp web/xgalaga.js
echo "Built: web/xgalaga.js (serve the repo's web/ directory and open index.html)"

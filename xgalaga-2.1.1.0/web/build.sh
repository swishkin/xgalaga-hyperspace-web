#!/bin/sh
# Build xgalaga-hyperspace for the browser (Emscripten/WebAssembly).
#
# Produces web/xgalaga.js (self-contained: wasm + level data inlined),
# to be served or opened together with web/index.html.
#
# Requires: emsdk on $HOME/emsdk and python3.  The bitmap font (web/fontdata.h)
# is static: it is the classic X 6x13 core font as rendered by an X server.
set -e
cd "$(dirname "$0")/.."

. "$HOME/emsdk/emsdk_env.sh" >/dev/null 2>&1

# Generated data (kept in the tree; regenerated on each build)
python3 web/mksounddata.py web/sounddata.h

# xgalaga-hyperspace = sources compiled WITHOUT -DORIGINAL_XGALAGA.
# The X11 libsprite is replaced by the web backends in web/:
#   wlib_web.c      Wlib windowing on an HTML canvas (framebuffer backend)
#   sound_web.c     Web Audio sound (replaces sound.c's forked sound server)
#   frate_web.c     emscripten_sleep frame pacing (replaces frate.c's SIGALRM)
#   joystick_web.c  no-op joystick (replaces linux-joystick.c, __linux__-gated)
#
# ASYNCIFY lets the blocking game loop yield to the browser's event loop
# via emscripten_sleep() (see frate_web.c).  EXIT_RUNTIME makes quit keys
# (Q) freeze the page instead of navigating away.  SINGLE_FILE inlines the
# wasm so the whole game is one .js file.
emcc -O2 -UORIGINAL_XGALAGA \
    -Iweb -I. \
    main.c data.c paths.c pathfile.c title.c explosions.c \
    score.c highscore.c prize.c images.c \
    web/wlib_web.c web/sound_web.c web/frate_web.c web/joystick_web.c \
    --embed-file levels@/levels \
    --embed-file web/CREDITS@/tmp/xgal_credits \
    -s ASYNCIFY=1 \
    -s EXIT_RUNTIME=1 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s SINGLE_FILE=1 \
    -o web/xgalaga.js
# Inline webglue.js (input bridge) at the front of the bundle: the deliverable
# is a single file, and one script tag avoids a browser cache desync between
# two separately-cached scripts.  webglue.js is a self-contained IIFE that
# must load before the emscripten module initializes.
cat web/webglue.js web/xgalaga.js > web/.xgalaga.tmp && mv web/.xgalaga.tmp web/xgalaga.js
echo "Built: web/xgalaga.js (serve the web/ directory and open index.html)"

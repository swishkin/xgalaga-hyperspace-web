# XGalaga: Hyperspace — browser build

A browser port of **xgalaga-hyperspace** (the SourceForge `xgalaga` project,
release 2.1.1.0), compiled to WebAssembly with Emscripten. The game runs in
any modern browser (Chrome, Firefox, Safari, Edge — anything with WASM and
Web Audio support).

The original X11/libsprite windowing layer is **not** used; it is replaced by
small web backends in this directory. The game's own C sources are compiled
with a small set of web-specific changes:

- `main.c` — keyboard is the default control mode (the original defaulted to
  mouse capture on the title screen); home-row keybinds `j`/`l`/`f`/`d`
  mapped to the game's left/right/fire/shield keys; `Q` (and `Shift+Q`)
  kill your ship and end the game back at the title instead of exiting the
  program (there is no program to exit in a browser tab); Enter no longer
  toggles fullscreen.
- `title.c` — two cosmetic patches (`const int` for auto-typedefs on modern
  compilers, and an explicit `<unistd.h>` include).

## What you need to run it

Nothing to install. Either:

- open `index.html` directly from disk (double-click), or
- serve the directory with any static file server, e.g.
  `python3 -m http.server 8000` from `web/`, then visit
  `http://localhost:8000/index.html`.

The build is a single self-contained `xgalaga.js` (WebAssembly + all level
files + sound samples + the `webglue.js` input bridge inlined), so no other
assets are fetched.

The canvas is scaled to an **integer** number of pixels by default (the
native game screen is 468×596), so sprites and text stay crisp instead of
being blurred by fractional stretching. If the window is smaller than one
native screen it falls back to a fractional scale.

Note: high scores are written to the browser's in-memory filesystem
(`$HOME/.xgalscores`, `/tmp/xgal_global_scores`) and do **not** persist
across page reloads.
## Controls

Keyboard control is the **default** (the original X11 build defaulted to the
mouse). Mouse control is still available via `m`.

| Input                          | Action                                     |
|--------------------------------|--------------------------------------------|
| `j` / ←                        | move ship left                             |
| `l` / →                        | move ship right                            |
| `f` / Space / LMB              | fire                                       |
| `d`                            | activate shield (hypo variant)             |
| `P`                            | pause                                      |
| `S`                            | toggle sound                               |
| `k` / `m`                      | switch to keyboard / mouse control         |
| `q`                            | kill your ship → game over → back to title |
| `Q` / `Shift+Q`                | quit the game (see note)                   |

Notes:

- A mouse click, or `k`/`m`, on the title screen starts a game.
- `Q`/`Shift+Q` quits the game the way the original quits (`xgal_exit`):
  the page tries `window.close()`. Browsers refuse to let a page close a
  tab the user opened, so in that case a full-screen note ("Game exited —
  you can close this tab.") is shown and the game halts behind it.
  Lowercase `q` only ends the current game, as in the original.
- Enter no longer does anything (browser fullscreen is left to the user /
  the browser UI).

## Rebuilding

Requirements:

- Emscripten (emsdk) installed at `$HOME/emsdk`
- `python3`

The bitmap font is a static header (`web/fontdata.h`) — no font tooling is
needed. It is the classic X 6x13 core font (the `6x13`/`fixed` family) as
rendered by a real X server: `libsprite/text.c` asks for the `6x10` core
font, which most modern X servers don't ship, and falls back through
`6x13`/`fixed` — so this is exactly what the native game draws on a
typical display.

Then:

```sh
web/build.sh          # → web/xgalaga.js
```

`build.sh` regenerates `web/sounddata.h` (from `sounds/*.raw`) on every
build, then compiles the game sources with:

```
emcc -O2 -UORIGINAL_XGALAGA -Iweb -I. \
    main.c data.c paths.c pathfile.c title.c explosions.c \
    score.c highscore.c prize.c images.c \
    web/wlib_web.c web/sound_web.c web/frate_web.c web/joystick_web.c \
    --embed-file levels@/levels \
    --embed-file web/CREDITS@/tmp/xgal_credits \
    -s ASYNCIFY=1 -s EXIT_RUNTIME=1 -s ALLOW_MEMORY_GROWTH=1 -s SINGLE_FILE=1 \
    -o web/xgalaga.js
```

`-UORIGINAL_XGALAGA` selects the **hyperspace** variant (shield, extra
weapons). The blocking game loop yields to the browser's event loop through
`emscripten_sleep()` (web/frate_web.c), which requires `-s ASYNCIFY=1`.
`-s SINGLE_FILE=1` inlines the wasm so the game is one .js file.
`--embed-file levels@/levels` embeds the level files because `pathfile.c`
requires `LEVELDIR/levelN.xgl` on disk. `--embed-file web/CREDITS@/tmp/xgal_credits`
embeds the scroll-credits text (the original reads `CREDITSFILE` from disk;
in the browser that path is provided by the embedded file).

After the emcc step, `build.sh` prepends `webglue.js` to the front of the
bundle. Keeping the input bridge and the game in one file means the page
loads a single script, which avoids a browser-cache desync between two
separately-cached scripts (and matches the single-file deliverable).

## Web backend files

| File              | Replaces                | Role                                          |
|-------------------|-------------------------|-----------------------------------------------|
| `wlib_web.c`      | `libsprite/` (X11)      | Wlib API on a 32-bit software framebuffer blitted to a `<canvas>`; XPM decoder (handles this game's 12-digit byte-doubled colors, e.g. `#FFFF00000000` = `#FF0000`, the `XPMEXT num_views` sprite-frame count, and `None` transparency); bitmap font (static `fontdata.h`); all draws clipped to the window rect, mirroring X child-window clipping; input event queue |
| `sound_web.c`     | `sound.c`               | Web Audio playback of the embedded 8-bit 8 kHz samples (original forks a `/dev/dsp` sound server) |
| `frate_web.c`     | `frate.c`               | `emscripten_sleep(33)` frame pacing (~30 FPS; original uses SIGALRM/sigsuspend) |
| `joystick_web.c`  | `linux-joystick.c`      | no-op (that file is `__linux__`-gated anyway) |
| `webglue.js`      | —                       | browser side: keyboard/mouse → event queue, audio unlock/playback, canvas setup; prepended to `xgalaga.js` at build time |
| `config.h`        | `./configure` output    | hand-written build configuration             |
| `CREDITS`         | `CREDITS` (in repo root) | the scroll-credits text, embedded at build time at `/tmp/xgal_credits` |
| `mksounddata.py`  | —                       | generates `sounddata.h` from `sounds/*.raw`  |
| `X11/Xlib.h`      | —                       | minimal type stubs so the stock `Wlib.h` compiles |

## Fidelity notes

Colors and fonts follow the original X11 sources, not a "nicer"
interpretation:

- **Palette** — the eight colors are the pristine colortable from
  `libsprite/data.c` (`W_White`, `W_Black`, `W_Red`, `W_Green`, `W_Yellow`,
  `W_Cyan`, `W_DarkGrey` = `#FFFF00`, `W_Grey` = `#C8C8C8`). Note that
  `W_DarkGrey` is a solid yellow by the original's own comment; it is the
  high-score highlight color.
- **`W_SetRGB16` is a deliberate no-op** — on a modern TrueColor X display
  the original returns before touching the palette, so the "multicolor
  blinking highlight" it was written for never happens; the highlight stays
  its one color.
- **Font** — `web/fontdata.h` holds the X 6x13 core font glyphs (95 × 13
  rows, baseline row 11) as a real X server renders them, which is what the
  native game falls back to when `6x10` is absent.
- **Window clipping** — every draw (text, lines, sprites) is clipped to its
  window's rectangle, exactly as the X server clips child-window draws.
  The score strip lives in the top-level shell window, so sprites entering
  the play window from above cannot overwrite it, as on a real display.
- **Framerate** — the game is a fixed-timestep simulation: every speed is
  in pixels-per-frame and every timer a frame counter, and one main-loop
  iteration is one simulation step plus one render plus one frame tick.
  The original paces that loop at 30 Hz (`frate.c`, `#define FPS 30`,
  ITIMER_REAL + sigsuspend) regardless of the display's refresh rate, and
  this build does the same (`web/frate_web.c`, `emscripten_sleep(33)`,
  measured ≈ 30 FPS). There is no "unlocked" mode in the original to
  replicate: running the loop faster would run the *game* faster (all
  motion and timers scale with the tick), and rendering more frames per
  tick would only repeat the same state, since the original does no
  interpolation between steps.


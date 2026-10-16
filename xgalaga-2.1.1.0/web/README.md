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

`leaderboard.py` (see High scores) is the recommended server: it serves the
game **and** the shared high-score API in one process.

The build is a single self-contained `xgalaga.js` (WebAssembly + all level
files + sound samples + the `webglue.js` input bridge inlined), so no other
assets are fetched.

The canvas is scaled to an **integer** number of pixels by default (the
native game screen is 468×596), so sprites and text stay crisp instead of
being blurred by fractional stretching. If the window is smaller than one
native screen it falls back to a fractional scale.

## High scores

The title screen shows a single **"High scores"** board. In the browser
build it is the shared online board (top 20 of the server's top 100); in
a native X11 build it is the per-user board (the original "Your high
scores" — the original's "global" file was world-writable and useless).
A newly entered score is highlighted on the board in the original
highlight color (`W_DarkGrey`, solid yellow in this game's palette).

- **Shared (browser) board** — a small self-hosted API server,
  `leaderboard.py` (Python 3 stdlib only, no dependencies). Run it as the
  web server:

  ```sh
  python3 web/leaderboard.py [port]   # default 8088
  ```

  and play at `http://localhost:8088/`. On load the game fetches the board
  from `/scores` and renders it on the title page; when a new high score
  is entered, it is POSTed to `/scores` and persists in `scores.json`
  (top 100 by default; edit the file to prune entries). The API is
  same-origin by default; if the game is served from a different origin,
  set `window.XGAL_LEADERBOARD_URL` in `index.html`. Without the server
  (e.g. opening `index.html` straight from disk) the board stays empty.
- **Per-user board** — still maintained: the name prompt appears when the
  score makes *either* the shared board or the per-user top 10, so a
  locally notable score still gets a name. In the browser build it lives
  in the page's in-memory filesystem (`$HOME/.xgalscores`) and resets on
  page reload; the shared board above is the persistent one.

Name entry passes literal keystrokes: the game-control remaps
(`f` = fire, `d` = shield, `j`/`l` = move, arrows) are disabled while the
name prompt is up, so typing e.g. `FRED` stores `fred`, not the fire/shield
key codes.

## Deploying with Docker

For a persistent setup (scores survive container updates; the image ships
only the game page and the server — no source tree):

```sh
web/build.sh          # build the bundle first (needs emsdk; see Rebuilding)
docker compose up -d  # from the repo root
```

Play at `http://localhost:8088/`. Every runtime knob is an environment
variable (see the `docker-compose.yml` comments and the `leaderboard.py`
docstring): port, board size, CORS origin, abuse limits. Scores persist in
a named volume mounted at `/data`. The server runs as `nobody`, and its
code lives outside the served directory, so the public endpoint can only
serve `index.html` and `xgalaga.js`.

## Security

**Client** — low risk. The bundle contains no `innerHTML`, no
`document.write`, no `eval`; board names and scores are drawn only as
canvas glyphs, so a malicious board entry (a name containing HTML or JS)
cannot execute code in a player's browser. There are no cookies or
localStorage (no stored state, no CSRF surface), and the only network
request the page makes is the `fetch` to the leaderboard URL configured in
`index.html` (deploy-controlled, not user-controllable).

**Leaderboard API** — unauthenticated by design: players can't hold a
secret, the game code is public. Mitigations in `leaderboard.py`:

- per-IP rate limit on submissions (default 5 per 60 s → 429);
  `X-Forwarded-For` is honored only from a local reverse proxy, so a remote
  client can't spoof its address;
- POST body cap (default 4 KiB → 413);
- score/level clamped to sane ranges (defaults 10⁹ / 9999), names
  truncated to 20 chars;
- `XGAL_ORIGIN` (default `*`): set it to the game's origin when hosting,
  so unrelated websites can't read or flood the board through a player's
  browser.

Remaining risks, and how to close them:

| Risk | Mitigation |
|------|------------|
| Score spam / flooding the board | in-server rate limit + caps; extra limits in a reverse proxy if needed |
| Plain HTTP (game and API traffic visible/alterable in transit) | TLS-terminating reverse proxy (Caddy/nginx + Let's Encrypt) — required for public use; if the game is HTTPS and the API is HTTP the browser blocks the fetch (mixed content) and the board simply stays empty |
| Forged scores (no signed submissions) | not fixable for a public client; caps + rate limit bound the damage — treat the board as a fun feature, not authoritative |
| Thread exhaustion under a connection flood | `ThreadingHTTPServer` is per-connection; put a reverse proxy (Caddy/nginx) in front for public deployment |
| Bundle tampering if the hosting path is compromised (no SRI) | keep the serving path behind TLS + a trustworthy host; for CDN delivery add `integrity`/`crossorigin` to the `<script>` tag (the hash must be regenerated on every `build.sh` run) |

Recommended public setup: `Internet → Caddy (TLS) → xgalaga container`,
with `XGAL_ORIGIN` set to the game's public origin.

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
    web/leaderboard_web.c \
    --embed-file levels@/levels \
    --embed-file web/CREDITS@/tmp/xgal_credits \
    -s ASYNCIFY=1 -s EXIT_RUNTIME=1 -s ALLOW_MEMORY_GROWTH=1 -s SINGLE_FILE=1 \
    -s EXPORTED_FUNCTIONS=['_main','_xgal_web_refresh','_xgal_web_getting_name'] \
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
| `frate_web.c`     | `frate.c`               | `emscripten_sleep(16)` frame pacing (~60 FPS; original paces its 30 Hz tick with SIGALRM/sigsuspend — see Framerate note) |
| `joystick_web.c`  | `linux-joystick.c`      | no-op (that file is `__linux__`-gated anyway) |
| `leaderboard_web.c` | —                    | C↔JS bridge for the shared high-score board: `xgal_web_submit()` (C → JS fetch POST on name entry), `xgal_web_refresh()` (JS → C, reload the global score file after the JS layer fetches the board), `xgal_web_getting_name()` (JS → C, name-prompt state so the input bridge types literal characters) |
| `webglue.js`      | —                       | browser side: keyboard/mouse → event queue, audio unlock/playback, canvas setup, leaderboard fetch/submit; prepended to `xgalaga.js` at build time |
| `leaderboard.py`  | —                       | self-hosted game + high-score API server (stdlib only); see High scores |
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
  in pixels-per-tick and every timer a tick counter, and one main-loop
  iteration is one simulation step plus one render plus one frame tick.
  The original paces that loop at 30 Hz (`frate.c`, `#define FPS 30`,
  ITIMER_REAL + sigsuspend) regardless of the display's refresh rate. This
  build paces it at **60 Hz** (`web/frate_web.c`, `emscripten_sleep(16)`,
  measured ≈ 60.4 Hz: the title page's 598-tick dwell measures 9.89 s) and
  retimes the simulation so wall-clock speed is identical to the original:
  per-tick speeds are halved (torps 12→6 px/tick, enemy torps 8→4, ship
  movement ±4/±3/±1→±2/±1.5/±0.5, star speeds, prize speed 3→1.5), every
  tick-count duration is doubled (title/score page timers 300→600,
  shield 300→600, death respawn 100→200, explosion 25→50, fire delay
  5→10), per-tick fire probabilities are halved (random `% tc` →
  `% 2*tc`, convoy attack `% 10000` → `% 20000`), and sprite animations
  (player ship, torps, explosions, star color cycling) step once per 2
  ticks to keep the original 30 Hz animation cadence. Path steering
  doubles the path-table steer values at read-out (`paths.c`,
  `pathfile.c`) with the turn rate doubled to match, so turn radius and
  level geometry are unchanged. Positions and speeds are floats where
  halving needs fractions; the Wlib draw API stays integer (rounded at the
  call site), so a sprite may differ from the original by ≤ 1 px. There is
  no "unlocked" mode in the original to replicate: running the loop faster
  without the retiming would run the *game* faster, and rendering more
  frames per tick would only repeat the same state, since the original
  does no interpolation between steps.
  The level-transition (warp) state machine is gated the same way, and
  both its `starspeed` increment and its `starspeed == 1` level-start
  check run on the same tick; gating only the increment left the check
  firing on the other ticks, which intermittently skipped the hyperspace
  jump (the next wave started immediately).


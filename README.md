# xgalaga-hyperspace-web

A browser build of **xgalaga** release 2.1.1.0 — the "hyperspace" variant
(shield and extra weapons; the non-`ORIGINAL_XGALAGA` build), compiled to
WebAssembly with Emscripten.  The game runs at 60 Hz (the original is a
30 fps X11 game), has home-row keyboard shortcuts, and a shared high-score
leaderboard.

Upstream:

- XGalaga home page (Joe Rumsey): <http://rumsey.org/xgal.html>
- Author's GitHub: <https://github.com/tinyogre>
- SourceForge project (releases, bugs): <https://sourceforge.net/projects/xgalaga/>

## Quick start

`xgalaga.js` is a committed build artifact, so no build step is needed to
play:

```sh
python3 leaderboard.py        # serves the game + shared board on :8088
# or any static file server (the shared board stays empty):
python3 -m http.server 8080
# then open http://localhost:8080/
```

The build is a single self-contained `xgalaga.js` (WebAssembly + all level
files + sound samples + the `webglue.js` input bridge inlined), so no other
assets are fetched.  The canvas is scaled to an **integer** number of pixels
by default (the native screen is 468×596), so sprites and text stay crisp
instead of being blurred by fractional stretching; a 1 px grey (`#808080`)
border frames the game so its edges are visible against the black page.

## Controls

Keyboard control is the **default** (the original X11 build defaulted to the
mouse); mouse control is available via `m`.

| Input                          | Action                                     |
|--------------------------------|--------------------------------------------|
| `j` / ←                        | move ship left                             |
| `l` / →                        | move ship right                            |
| `f` / Space / LMB              | fire                                       |
| `d`                            | activate shield (hyperspace variant)       |
| `p`                            | pause                                      |
| `b`                            | toggle buffering                           |
| `s`                            | toggle sound                               |
| `k` / `m`                      | switch to keyboard / mouse control         |
| `q` (in game)                  | kill your ship → game over                 |
| `q` / `Q` (title screen)       | quit the game                              |
| `Enter` (title screen)         | start a game                               |

Notes:

- A mouse click, or `k`/`m`, on the title screen starts a game.
- Quitting (title-screen `q`/`Q`) halts the game behind a full-screen note
  ("Game exited — you can close this tab."): browsers refuse to let a page
  close a tab the user opened, and `-s EXIT_RUNTIME` freezes the runtime
  instead of navigating away.  Lowercase `q` in-game only ends the current
  game, as in the original.
- The original's Alt+Enter fullscreen toggle is a no-op in the browser
  build (`W_ToggleFullscreen` is a stub); fullscreen is left to the browser
  UI.

## Repository layout

- `xgalaga-2.1.1.0/` — the **unmodified** upstream 2.1.1.0 release, kept
  bit-for-bit identical to the official SourceForge tarball
  (`xgalaga-2.1.1.0.tar.gz`, SHA-256
  `adcfbfd04876f5197c60b37af0ad89a629e553d6e09314a4b3b5c70f6c634f9b`), so the
  original stays referenceable at any time without redownloading it.  No
  C-side change ever lands in this tree: everything the web port changes in
  the game lives in [`patches/0001-web-port.patch`](patches/0001-web-port.patch)
  and is applied to a throwaway copy at build time (see [Building](#building)
  and [Differences from upstream](#differences-from-upstream-2110)).
- repo root — the web layer: `build.sh`, `index.html`, the built
  `xgalaga.js`, `webglue.js` (input/audio bridge), the Wlib/sound/frate
  backends (`wlib_web.c`, `sound_web.c`, `frate_web.c`, `joystick_web.c`,
  `leaderboard_web.c`), the leaderboard server `leaderboard.py`, hand-written
  `config.h`, the `X11/Xlib.h` type stub, font/sound data headers and their
  generators, `CREDITS` (scroll-credits text), and page icons.

## Building

```sh
./build.sh          # → xgalaga.js at the repo root
```

Requirements: Emscripten (emsdk) on `$HOME/emsdk`, `python3`, and `patch`.

`build.sh`:

1. stages a throwaway copy of `xgalaga-2.1.1.0/` in a temp dir and applies
   `patches/0001-web-port.patch` to that copy (the pristine tree is never
   touched),
2. regenerates `sounddata.h` from `xgalaga-2.1.1.0/sounds/*.raw`
   (`mksounddata.py`; `bigfontdata.h` is static),
3. compiles the staged game sources with the web backends:

   ```
   emcc -O2 -UORIGINAL_XGALAGA -I. -I<stage>/xgalaga-2.1.1.0 \
       <stage>/xgalaga-2.1.1.0/main.c ... wlib_web.c sound_web.c frate_web.c \
       joystick_web.c leaderboard_web.c \
       --embed-file <stage>/xgalaga-2.1.1.0/levels@/levels \
       --embed-file CREDITS@/tmp/xgal_credits \
       -s ASYNCIFY=1 -s EXIT_RUNTIME=1 -s ALLOW_MEMORY_GROWTH=1 \
       -s SINGLE_FILE=1 \
       -s EXPORTED_FUNCTIONS=['_main','_xgal_web_refresh','_xgal_web_getting_name'] \
       -o xgalaga.js
   ```

   `-UORIGINAL_XGALAGA` selects the **hyperspace** variant (shield, extra
   weapons).  The blocking game loop yields to the browser's event loop
   through `emscripten_sleep()` (`frate_web.c`), which requires
   `-s ASYNCIFY=1`.  `-s SINGLE_FILE=1` inlines the wasm so the game is one
   .js file.  `--embed-file levels@/levels` embeds the level files because
   `pathfile.c` requires `LEVELDIR/levelN.xgl` on disk.  The `CREDITS` file
   is embedded at `/tmp/xgal_credits` (the original reads `CREDITSFILE` from
   disk; in the browser that path is provided by the embedded file).

After the emcc step, `build.sh` prepends `webglue.js` to the bundle, so the
page loads a single script (avoiding a browser-cache desync between two
separately-cached scripts).

## High scores

The title screen shows a **"High scores"** board.  In the browser build it
is the shared online board (top 20 of the server's top 100); in a native X11
build it is the per-user board.  A newly entered score is highlighted in the
original highlight color (`W_DarkGrey`, solid yellow in this game's palette).

- **Shared (browser) board** — a small self-hosted API server,
  `leaderboard.py` (Python 3 stdlib only, no dependencies).  Run it as the
  web server:

  ```sh
  python3 leaderboard.py [port]   # default 8088
  ```

  and play at `http://localhost:8088/`.  On load the game fetches the board
  from `/scores` and renders it on the title page; when a new high score is
  entered, it is POSTed to `/scores` and persists in `scores.json` (top 100
  by default; edit the file to prune entries).  The API is same-origin by
  default; if the game is served from a different origin, set
  `window.XGAL_LEADERBOARD_URL` in `index.html`.  Without the server (e.g.
  opening `index.html` straight from disk) the board stays empty.
- **Per-user board** — still maintained: the name prompt appears when the
  score makes *either* the shared board or the per-user top 10, so a
  locally notable score still gets a name.  In the browser build it lives in
  the page's in-memory filesystem and resets on page reload; the shared
  board is the persistent one.

Name entry passes literal keystrokes: the game-control remaps
(`f` = fire, `d` = shield, `j`/`l` = move, arrows) are disabled while the
name prompt is up, so typing e.g. `FRED` stores `fred`, not fire/shield key
codes.

## Deploying with Docker

For a persistent setup (scores survive container updates; the image ships
only the game page and the server — no source tree):

```sh
./build.sh            # build the bundle first (needs emsdk; see Building)
docker compose up -d  # from the repo root
```

Play at `http://localhost:8088/`.  Every runtime knob is an environment
variable (see the `docker-compose.yml` comments and the `leaderboard.py`
docstring): port, board size, CORS origin, abuse limits.  Scores persist in
a named volume mounted at `/data`.  The server runs as `nobody`, and its
code lives outside the served directory, so the public endpoint can only
serve `index.html` and `xgalaga.js`.

## Security

**Client** — low risk.  The bundle contains no `innerHTML`, no
`document.write`, no `eval`; board names and scores are drawn only as canvas
glyphs, so a malicious board entry (a name containing HTML or JS) cannot
execute code in a player's browser.  There are no cookies or localStorage
(no stored state, no CSRF surface), and the only network request the page
makes is the `fetch` to the leaderboard URL configured in `index.html`
(deploy-controlled, not user-controllable).

**Leaderboard API** — unauthenticated by design: players can't hold a
secret, the game code is public.  Mitigations in `leaderboard.py`:

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

## Differences from upstream 2.1.1.0

All of these live in `patches/0001-web-port.patch` (1336 lines, 13 files), which is
applied to a throwaway copy of the tree at build time.

### Gameplay: per-level MINTORPS floors

Upstream, deaths and lemons drive your torpedoes back down to `MINTORPS`
(3 single / 4 double / ...), so by levels 60–90 you are dodging 300+ enemy
torps with 3 shots.  This build raises the floor every 15 levels (the level
cycle repeats after 15), via `weapon_mintorps(weapon, level)` in `data.c`:

| weapon  | 1-15 | 16-30 | 31-45 | 46-60 | 61-75 |
|---------|------|-------|-------|-------|-------|
| SINGLE  | 3    | 5     | 7     | 9     | 11    |
| DOUBLE  | 4    | 6     | 8     | 10    | 12    |
| TRIPLE  | 6    | 9     | 12    | 15    | 15    |
| SPREAD  | 5    | 7     | 9     | 11    | 13    |
| MACHINE | 3    | 5     | 7     | 9     | 11    |

(capped at `MAXTORPS`, raised 10 → 15 to fit).  The floor is applied at
game start, on death, on lemon, and when picking up a weapon (`prize.c`).
Difficulty still ramps through the enemies; this only stops firepower from
collapsing.  More late-game tuning ideas are documented in
[GAMEPLAY_IDEAS.md](GAMEPLAY_IDEAS.md).

### 60 Hz conversion

Durations are doubled and per-frame speeds halved so gameplay timing
matches the 30 fps original:

- per-tick speeds halved (torps 12→6 px/tick, enemy torps 8→4, ship
  movement ±4/±3/±1 → ±2/±1.5/±0.5, star speeds, prize speed 3→1.5);
- every tick-count duration doubled (title/score page timers 300→600,
  shield 300→600, death respawn 100→200, explosion 25→50, fire delay
  5→10, entry delays and path durations ×2 at read-out in `pathfile.c`);
- per-tick fire probabilities halved (`% tc` → `% 2*tc`, convoy attack
  `% 10000` → `% 20000`);
- sprite animations (player ship, torps, explosions, star color cycling)
  step once per 2 ticks to keep the original 30 Hz animation cadence;
- path steering doubles the path-table steer values at read-out
  (`paths.c`, `pathfile.c`) with the turn rate doubled to match, so turn
  radius and level geometry are unchanged;
- positions and speeds are floats where halving needs fractions (`struct.h`,
  `data.h`, `main.c`); the Wlib draw API stays integer (rounded at the call
  site), so a sprite may differ from the original by ≤ 1 px.

There is no "unlocked" mode in the original to replicate: running the loop
faster without the retiming would run the *game* faster, and rendering more
frames per tick would only repeat the same state, since the original does no
interpolation between steps.

The level-8-type "slither" entry paths use `enter_speed()` in `main.c`,
which reproduces the original's 30 Hz *integer* arithmetic
(`m + metaLevel*m/2`, truncating division) and then halves the result per
tick — a plain float halving made odd-component directions 25% too fast and
visibly widened the slither.

The level-transition (warp) state machine is gated the same way: both the
`starspeed` increment and its `starspeed == 1` level-start check run on the
same tick; gating only the increment left the check firing on the other
ticks, which intermittently skipped the hyperspace jump (the next wave
started immediately).

### Rendering

- The "LEVEL N" level-intro text uses the same font the original X server
  loads for `W_BigFont` (XLFD `-adobe-helvetica-bold-r-normal--34-*`,
  Nimbus Sans Bold here): bitmap glyphs generated by `mkbigfont.py` into
  `bigfontdata.h`, drawn with proportional pen advances to match the
  original's spacing.
- A 1 px grey (`#808080`) border frames the game canvas so its edges are
  visible against the black page.

### Input

- Keyboard control is the default and home-row keybinds
  `j`/`l`/`f`/`d` map to left/right/fire/shield (the original defaulted to
  mouse capture on the title screen).
- Browsers stop delivering `keyup` once the page loses focus, which left
  the C-side key state (`static keys` in `do_player`) holding a movement
  key — the rare "J gets stuck" drift.  `webglue.js` synthesizes releases
  for the game-control keys (ctrl-b, ctrl-f, space, `x`) on `blur` and
  `visibilitychange`, and `do_player` resets `keys` when a new game starts
  so a key released during the game-over screen can't leak into the next
  game.
- `title.c` carries two cosmetic build fixes (`const int` for auto-typedefs
  on modern compilers, an explicit `<unistd.h>` include) and a redraw-order
  fix so the bottom control hint isn't erased by the scrolling credits.

### Fidelity notes

Colors and fonts follow the original X11 sources, not a "nicer"
interpretation:

- **Palette** — the eight colors are the colortable from
  `libsprite/data.c` (`W_White`, `W_Black`, `W_Red`, `W_Green`, `W_Yellow`,
  `W_Cyan`, `W_DarkGrey` = `#FFFF00`, `W_Grey` = `#C8C8C8`).  Note that
  `W_DarkGrey` is a solid yellow by the original's own comment; it is the
  high-score highlight color.
- **`W_SetRGB16` is a deliberate no-op** — on a modern TrueColor X display
  the original returns before touching the palette, so the "multicolor
  blinking highlight" it was written for never happens; the highlight stays
  its one color.
- **Font** — `fontdata.h` holds the X 6x13 core font glyphs (95 × 13 rows,
  baseline row 11) as a real X server renders them.  `libsprite/text.c`
  asks for the `6x10` core font, which most modern X servers don't ship, and
  falls back through `6x13`/`fixed` — so this is exactly what the native
  game draws on a typical display.
- **Window clipping** — every draw (text, lines, sprites) is clipped to its
  window's rectangle, exactly as the X server clips child-window draws.
  The score strip lives in the top-level shell window, so sprites entering
  the play window from above cannot overwrite it, as on a real display.
- **Framerate** — the game is a fixed-timestep simulation: every speed is
  in pixels-per-tick and every timer a tick counter, and one main-loop
  iteration is one simulation step plus one render plus one frame tick.
  The original paces that loop at 30 Hz (`frate.c`, ITIMER_REAL +
  sigsuspend) regardless of the display's refresh rate; this build paces it
  at 60 Hz (`frate_web.c`, `emscripten_sleep(16)`) with the retiming above,
  so wall-clock speed is identical to the original.

## Web backend files

| File                | Replaces                | Role                                          |
|---------------------|-------------------------|-----------------------------------------------|
| `wlib_web.c`        | `libsprite/` (X11)      | Wlib API on a 32-bit software framebuffer blitted to a `<canvas>`; XPM decoder (handles this game's 12-digit byte-doubled colors, e.g. `#FFFF00000000` = `#FF0000`, the `XPMEXT num_views` sprite-frame count, and `None` transparency); bitmap font (static `fontdata.h`); proportional big font (`bigfontdata.h`); all draws clipped to the window rect, mirroring X child-window clipping; input event queue |
| `sound_web.c`       | `sound.c`               | Web Audio playback of the embedded 8-bit 8 kHz samples (original forks a `/dev/dsp` sound server) |
| `frate_web.c`       | `frate.c`               | `emscripten_sleep(16)` frame pacing (~60 FPS; original paces its 30 Hz tick with ITIMER_REAL/sigsuspend) |
| `joystick_web.c`    | `linux-joystick.c`      | no-op (that file is `__linux__`-gated anyway) |
| `leaderboard_web.c` | —                       | C↔JS bridge for the shared high-score board: `xgal_web_submit()` (C → JS fetch POST on name entry), `xgal_web_refresh()` (JS → C, reload the score board after the JS layer fetches it), `xgal_web_getting_name()` (JS → C, name-prompt state so the input bridge types literal characters) |
| `webglue.js`        | —                       | browser side: keyboard/mouse → event queue, audio unlock/playback, canvas setup, blur keyup synthesis, leaderboard fetch/submit; prepended to `xgalaga.js` at build time |
| `leaderboard.py`    | —                       | self-hosted game + high-score API server (stdlib only); see High scores |
| `index.html`        | —                       | page: canvas, 1 px grey border, integer-pixel fit scaling, single script tag |
| `favicon.ico`, `icon.png` | — | page favicon: the player-ship sprite (`images/player1.xpm`, frame 1) at 16/32/48/64 px (`.ico`) and 512 px (`.png`), nearest-neighbor scaled, transparency kept; the original X11 build sets no window icon, so this sprite is the game's canonical icon |
| `config.h`          | `./configure` output    | hand-written build configuration (window size, score file paths, etc.) |
| `CREDITS`           | `CREDITS` (in the game tree) | the scroll-credits text (identical copy), embedded at build time at `/tmp/xgal_credits` |
| `mksounddata.py`    | —                       | generates `sounddata.h` from `xgalaga-2.1.1.0/sounds/*.raw` |
| `mkbigfont.py`      | —                       | generates `bigfontdata.h` from a system Helvetica Bold (Nimbus Sans Bold) |
| `X11/Xlib.h`        | —                       | minimal type stubs so the stock `Wlib.h` compiles |

## License

Copyright (C) 1995-1998 Joe Rumsey.  The original XGalaga was placed under
the GNU General Public License by its author (see the upstream README and
the full GPL text embedded in `xgalaga-2.1.1.0/copyright.h`); this browser
edition, including the web backends and the patch above, is distributed
under the same license.  See [LICENSE](LICENSE) for the full text.
Modifying, redistributing, and hosting the game are all permitted under the
GPL v2, provided the copyright notice and license terms are kept.

#!/usr/bin/env python3
"""XGalaga Hyperspace — global high-score leaderboard (self-hosted).

One process serves both the static web game and a tiny JSON API for a shared,
persistent high-score board. No dependencies (Python 3 stdlib only).

Storage is a plain, human-editable JSON file (default: scores.json next to this
script) holding an array of {"name", "score", "level"} objects, one per line,
kept sorted by score (descending) and trimmed to the top MAX entries. To
clean up the board, edit that file by hand (delete an entry's three lines) and
restart the server — or edit it while it's running, since it is re-read on
every request.

Run:
    python3 leaderboard.py [port]

Environment (all optional):
    XGAL_PORT           listen port          (default 8088; or first CLI arg)
    XGAL_HOST           bind address         (default 0.0.0.0)
    XGAL_WEBDIR         static dir to serve  (default: this file's directory)
    XGAL_SCORES         scores file path     (default: <webdir>/scores.json)
    XGAL_MAX_HIGH_SCORES entries to keep     (default 100)
    XGAL_ORIGIN         CORS allowed origin  (default "*"; set to the game's
                                             origin, e.g. https://x.g, to stop
                                             other websites from using the API)
    XGAL_DEBUG_PANEL    serve the page with the in-game debug panel
                        enabled               (default false; the panel's C
                                             bridge is always compiled into
                                             the bundle, see build.sh)
    XGAL_TRUSTED_PROXIES addresses/ranges whose X-Forwarded-For header may
                        be trusted       (default 127.0.0.1/32,::1/128; add
                                             the reverse proxy's network)

Abuse limits for unauthenticated POSTs (all optional):
    XGAL_MAX_SCORE      max score accepted   (default 1000000000)
    XGAL_MAX_LEVEL      max level accepted   (default 9999)
    XGAL_MAX_BODY       max POST body bytes  (default 4096)
    XGAL_RATE_LIMIT     max POSTs per client IP per window (default 5)
    XGAL_RATE_WINDOW    rate-limit window in seconds (default 60)

Endpoints:
    GET  /scores   -> JSON array of entries (sorted desc, top MAX)
    POST /scores   -> body {"name": "...", "score": N, "level": N}; inserts,
                     re-sorts, trims to MAX, persists, returns the new board.
                     Rate-limited per client IP (429) and size-capped (413).
    GET  /         -> the static game (index.html, xgalaga.js, ...)
"""
import ipaddress
import json
import os
import sys
import threading
import time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("XGAL_PORT") or (sys.argv[1] if len(sys.argv) > 1 else 8088))
HOST = os.environ.get("XGAL_HOST", "0.0.0.0")
# The served directory holds ONLY the game assets (web/): keeping it out of
# the repo root is what stops a default run from publishing .git/, .env
# and the source tree.
WEBDIR = os.environ.get("XGAL_WEBDIR", os.path.join(HERE, "web"))
# The scores file lives OUTSIDE the served directory by default, so it is
# not downloadable as a static file.
SCORES = os.environ.get("XGAL_SCORES", os.path.join(HERE, "scores.json"))
MAXN = int(os.environ.get("XGAL_MAX_HIGH_SCORES", "100"))
ORIGIN = os.environ.get("XGAL_ORIGIN", "*")

# Abuse limits: a public, unauthenticated endpoint gets probed.  Keep
# entries sane (real scores are far below these) and each client polite.
MAX_SCORE = int(os.environ.get("XGAL_MAX_SCORE", "1000000000"))
MAX_LEVEL = int(os.environ.get("XGAL_MAX_LEVEL", "9999"))
MAX_BODY = int(os.environ.get("XGAL_MAX_BODY", "4096"))
RATE_LIMIT = int(os.environ.get("XGAL_RATE_LIMIT", "5"))
RATE_WINDOW = int(os.environ.get("XGAL_RATE_WINDOW", "60"))

# Debug panel: the C bridge (xgal_web_debug_*) is always compiled into the
# bundle (see build.sh); whether the panel is actually SHOWN is decided here,
# at runtime, from the environment.  The flag is injected into the served
# index.html, before the page's own scripts run, so an operator can turn the
# panel on for a deployment without rebuilding anything:
#
#     XGAL_DEBUG_PANEL=true python3 leaderboard.py
#
# Default: off.  Anyone who can enable it can also use the panel's powerup
# setters to farm scores on the shared board, so keep it off on a public
# deployment unless you trust everyone who can reach it.
DEBUG_PANEL = os.environ.get("XGAL_DEBUG_PANEL", "").strip().lower() in (
    "1", "true", "yes", "on")

# The name field of a score record is 20 bytes in the C side (highscore.c:
# `char name[20]`), and it must hold a terminating NUL: the game prints it
# with %s.  19 characters + NUL is also exactly what the native X11 build
# accepts (score_key() stops at nnpos < 19), so both agree on the limit.
MAX_NAME = 19

_lock = threading.Lock()


# --- per-client-IP POST rate limiting -------------------------------------
# In-memory fixed window; resets on restart (that is acceptable: it bounds
# damage, it is not an identity).
_rl_lock = threading.Lock()
_rl_hits = {}  # ip -> [count, window_start]


def _rate_allows(ip):
    now = time.monotonic()
    with _rl_lock:
        if len(_rl_hits) > 10000:  # bound memory under an IP-scan flood
            for k in [k for k, v in _rl_hits.items() if now - v[1] > RATE_WINDOW]:
                del _rl_hits[k]
        n, start = _rl_hits.get(ip, (0, now))
        if now - start > RATE_WINDOW:
            n, start = 0, now
        if n >= RATE_LIMIT:
            return False
        _rl_hits[ip] = [n + 1, start]
        return True


# --- trusted proxies ------------------------------------------------------
# A reverse proxy in front of the server makes every request look like it
# comes from the proxy's address, which would give all visitors ONE shared
# rate-limit bucket.  X-Forwarded-For carries the real address, but it can
# only be trusted when the request really came from a proxy we control.
#
# XGAL_TRUSTED_PROXIES is a comma-separated list of addresses or CIDR
# networks.  The default trusts only the loopback interface (a proxy on
# the same host).  In docker, the proxy usually reaches the container over
# the bridge network, so add that network, e.g.:
#
#     XGAL_TRUSTED_PROXIES=127.0.0.1/32,::1/128,172.16.0.0/12
#
def _parse_trusted(spec):
    nets = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            nets.append(ipaddress.ip_network(part, strict=False))
        except ValueError:
            print("WARNING: ignoring invalid XGAL_TRUSTED_PROXIES entry %r" % part)
    return nets


TRUSTED_PROXIES = _parse_trusted(
    os.environ.get("XGAL_TRUSTED_PROXIES", "127.0.0.1/32,::1/128"))


def _is_trusted_proxy(addr):
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        return False
    return any(ip in net for net in TRUSTED_PROXIES)


def _valid_ip(addr):
    try:
        ipaddress.ip_address(addr)
    except ValueError:
        return False
    return True


def _norm(o):
    """Coerce an entry dict to {name:str<=19, score:int, level:int}, clamping
    score/level into the accepted ranges (out-of-range input is a bad client
    or a hand-edit, never a real score).

    The name is capped at 19 characters: the game's score record keeps the
    name in a 20-byte field that has to include a terminating NUL, and the
    native X11 build accepts the same 19 characters."""
    if not isinstance(o, dict):
        o = {}
    name = str(o.get("name", ""))[:MAX_NAME]
    try:
        score = int(o.get("score", 0))
    except (TypeError, ValueError):
        score = 0
    try:
        level = int(o.get("level", 0))
    except (TypeError, ValueError):
        level = 0
    return {"name": name,
            "score": max(0, min(score, MAX_SCORE)),
            "level": max(0, min(level, MAX_LEVEL))}


def _read():
    """Read + normalize + sort the scores file. Caller holds _lock."""
    if not os.path.exists(SCORES):
        return []
    try:
        with open(SCORES, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    if not isinstance(data, list):
        return []
    entries = [_norm(e) for e in data]
    entries.sort(key=lambda e: e["score"], reverse=True)
    return entries[:MAXN]


def _write(entries):
    """Atomically write the scores file. Caller holds _lock."""
    tmp = SCORES + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            if entries:
                f.write("[\n")
                for i, e in enumerate(entries):
                    line = "  " + json.dumps(e, ensure_ascii=False)
                    f.write(line + ("," if i < len(entries) - 1 else "") + "\n")
                f.write("]\n")
            else:
                f.write("[]\n")
        os.replace(tmp, SCORES)
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def get_board():
    with _lock:
        return _read()


class ScoreStoreError(Exception):
    """The scores file could not be written (permissions, missing dir...)."""


def add_score(entry):
    with _lock:
        entries = _read()
        entries.append(_norm(entry))
        entries.sort(key=lambda e: e["score"], reverse=True)
        entries = entries[:MAXN]
        try:
            _write(entries)
        except OSError as e:
            raise ScoreStoreError(str(e))
        return entries


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEBDIR, **kwargs)

    def _client_ip(self):
        """Client IP for rate limiting.

        X-Forwarded-For is honored only when the direct peer is a trusted
        proxy, so a remote client cannot spoof its own address.  Of the
        forwarded addresses we take the RIGHTMOST one: that is the address
        the proxy itself saw, i.e. the real client.  The leftmost entry is
        the one a client can put there itself (proxies append to the
        header, they do not replace it), so trusting it would let anyone
        choose their own rate-limit bucket."""
        peer = self.client_address[0]
        if _is_trusted_proxy(peer):
            xff = self.headers.get("X-Forwarded-For", "")
            if xff:
                candidate = xff.rsplit(",", 1)[-1].strip()
                if _valid_ip(candidate):
                    return candidate
        return peer

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _send_page(self, body, head_only=False):
        """Serve the (flag-injected) game page."""
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def _game_page(self):
        """Read index.html and inject the debug-panel flag, or None if the
        file is missing (fall back to the static handler)."""
        try:
            with open(os.path.join(WEBDIR, "index.html"), "rb") as f:
                html = f.read().decode("utf-8", "replace")
        except OSError:
            return None
        flag = ('<script>window.XGAL_DEBUG_WEBUI = %s;</script>'
                % ("true" if DEBUG_PANEL else "false"))
        # Inject into <head> so the flag is set before the page's own
        # scripts run.  A later explicit assignment in index.html still
        # wins, because it runs after this one.
        i = html.lower().find("<head>")
        i = 0 if i < 0 else i + len("<head>")
        return (html[:i] + "\n" + flag + html[i:]).encode("utf-8")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/scores", "/scores/"):
            self._send_json(200, get_board())
            return
        if path in ("/", "/index.html"):
            body = self._game_page()
            if body is not None:
                self._send_page(body)
                return
        super().do_GET()

    def do_HEAD(self):
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            body = self._game_page()
            if body is not None:
                self._send_page(body, head_only=True)
                return
        super().do_HEAD()

    def do_POST(self):
        if urlparse(self.path).path not in ("/scores", "/scores/"):
            self.send_response(404)
            self.end_headers()
            return
        if not _rate_allows(self._client_ip()):
            self._send_json(429, {"error": "rate limit exceeded"})
            return
        # A submission must declare its body length.  A request with a
        # chunked body (or no Content-Length at all) would otherwise be
        # read as an empty body and stored as a blank entry, and its
        # leftover bytes would stay in the connection buffer.
        if self.headers.get("Transfer-Encoding"):
            self._send_json(400, {"error": "chunked requests are not supported"})
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._send_json(400, {"error": "invalid Content-Length"})
            return
        if n <= 0:
            self._send_json(400, {"error": "missing or empty request body"})
            return
        if n > MAX_BODY:
            self._send_json(413, {"error": "body too large"})
            return
        try:
            data = json.loads(self.rfile.read(n) or b"{}")
        except (OSError, ValueError):
            self._send_json(400, {"error": "invalid JSON body"})
            return
        try:
            board = add_score(data)
        except ScoreStoreError as e:
            # The scores file is not writable (e.g. a docker bind mount the
            # container's unprivileged user cannot write): say so instead of
            # dropping the connection with a traceback.
            self._send_json(500, {"error": "cannot save the scores file: %s" % e})
            return
        self._send_json(200, board)

    def log_message(self, fmt, *args):  # keep the console quiet
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def _check_store():
    """Warn at startup if the scores file cannot be written.

    The usual cause is a docker bind mount that the container's
    unprivileged user ('nobody', uid 65534) cannot write: the server would
    then answer every submission with a 500 and the scores would silently
    never be saved."""
    d = os.path.dirname(SCORES) or "."
    if not os.path.isdir(d):
        try:
            os.makedirs(d, exist_ok=True)
        except OSError as e:
            print("WARNING: the scores directory %s does not exist and "
                  "cannot be created (%s); scores cannot be saved" % (d, e))
            return
    if not os.access(d, os.W_OK):
        print("WARNING: the scores directory %s is not writable by this "
              "process (uid %d); scores cannot be saved.  With docker, the "
              "bind-mounted ./data must be writable by the container user: "
              "chmod 777 data" % (d, os.getuid()))


def main():
    os.makedirs(WEBDIR, exist_ok=True)
    _check_store()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(
        "XGalaga Hyperspace: game + leaderboard on http://%s:%d/  "
        "(scores: %s, keep top %d)" % (HOST, PORT, SCORES, MAXN),
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

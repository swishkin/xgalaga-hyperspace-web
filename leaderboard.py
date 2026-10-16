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
WEBDIR = os.environ.get("XGAL_WEBDIR", HERE)
SCORES = os.environ.get("XGAL_SCORES", os.path.join(WEBDIR, "scores.json"))
MAXN = int(os.environ.get("XGAL_MAX_HIGH_SCORES", "100"))
ORIGIN = os.environ.get("XGAL_ORIGIN", "*")

# Abuse limits: a public, unauthenticated endpoint gets probed.  Keep
# entries sane (real scores are far below these) and each client polite.
MAX_SCORE = int(os.environ.get("XGAL_MAX_SCORE", "1000000000"))
MAX_LEVEL = int(os.environ.get("XGAL_MAX_LEVEL", "9999"))
MAX_BODY = int(os.environ.get("XGAL_MAX_BODY", "4096"))
RATE_LIMIT = int(os.environ.get("XGAL_RATE_LIMIT", "5"))
RATE_WINDOW = int(os.environ.get("XGAL_RATE_WINDOW", "60"))

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


def _norm(o):
    """Coerce an entry dict to {name:str<=20, score:int, level:int}, clamping
    score/level into the accepted ranges (out-of-range input is a bad client
    or a hand-edit, never a real score)."""
    if not isinstance(o, dict):
        o = {}
    name = str(o.get("name", ""))[:20]
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


def get_board():
    with _lock:
        return _read()


def add_score(entry):
    with _lock:
        entries = _read()
        entries.append(_norm(entry))
        entries.sort(key=lambda e: e["score"], reverse=True)
        entries = entries[:MAXN]
        _write(entries)
        return entries


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEBDIR, **kwargs)

    def _client_ip(self):
        """Client IP for rate limiting.  X-Forwarded-For is honored only when
        the direct peer is loopback (a local reverse proxy), so a remote
        client cannot spoof its own address."""
        peer = self.client_address[0]
        if peer in ("127.0.0.1", "::1"):
            xff = self.headers.get("X-Forwarded-For", "")
            if xff:
                return xff.split(",")[0].strip()
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

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if urlparse(self.path).path in ("/scores", "/scores/"):
            self._send_json(200, get_board())
            return
        super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path not in ("/scores", "/scores/"):
            self.send_response(404)
            self.end_headers()
            return
        if not _rate_allows(self._client_ip()):
            self._send_json(429, {"error": "rate limit exceeded"})
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > MAX_BODY:
                self._send_json(413, {"error": "body too large"})
                return
            data = json.loads(self.rfile.read(n) or b"{}")
        except (OSError, ValueError):
            self._send_json(400, {"error": "invalid JSON body"})
            return
        self._send_json(200, add_score(data))

    def log_message(self, fmt, *args):  # keep the console quiet
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    os.makedirs(WEBDIR, exist_ok=True)
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

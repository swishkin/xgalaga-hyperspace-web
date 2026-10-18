/* webglue.js - browser side of the xgalaga-hyperspace web build.
 *
 * Owns the input event queue consumed by wlib_web.c, tracks the mouse,
 * and drives the Web Audio playback of the embedded 8000 Hz samples.
 * Key encoding matches libsprite/event.c: plain char, char+128 with
 * Control (arrow keys map to ctrl-b/ctrl-f), char+256 with Alt.
 */
(function () {
    "use strict";

    var evq = [];
    var mouse = { x: 0, y: 0, down: false };
    var canvas = null;

    function pushEvent(type, key, x, y, idx) {
        var v = type |
            ((key & 0x3FF) << 8) |
            ((x & 0x3FF) << 18) |
            ((y & 0x3FF) << 28) |
            ((idx & 0xF) << 38);
        evq.push(v);
    }

    /* Non-zero while the high-score name prompt is up (queried from C via the
     * exported xgal_web_getting_name).  In that state the game-control remaps
     * below must not apply, or typing f/d/j/l would produce the fire/shield/
     * move key codes instead of the literal characters. */
    function inNameEntry() {
        try {
            return !!(M && M._xgal_web_getting_name && M._xgal_web_getting_name());
        } catch (e) { return false; }
    }


    /* --- keymap -----------------------------------------------------------
     * The four game actions and the game key codes they send:
     *   move left -> 226 (ctrl-b)   move right -> 230 (ctrl-f)
     *   fire      -> 32  (space)    shield     -> 120 ('x')
     * Each action carries one or two physical key bindings (e.key values).
     * The user rebinds them in the key settings popup (settings_ui.js);
     * the result is stored in localStorage.  Space always acts as fire
     * regardless of the keymap, as in the original game.
     */
    var ACTION_GAME = { left: 226, right: 230, fire: 32, shield: 120 };
    var ACTION_ORDER = ["left", "right", "fire", "shield"];
    var PRESETS = {
        wasd:   { left: ["a"], right: ["d"], fire: [" "], shield: ["x"] },
        arrows: { left: ["ArrowLeft"], right: ["ArrowRight"],
                  fire: [" "], shield: ["x"] },
        ijkl:   { left: ["j"], right: ["l"], fire: ["f"], shield: ["d"] }
    };
    var DEFAULT_KEYMAP = {
        left: ["ArrowLeft", "j"],
        right: ["ArrowRight", "l"],
        fire: ["f"],
        shield: ["d"]
    };
    var KEYMAP_STORAGE = "xgal-keymap-v1";
    var keymapListeners = [];

    function validKey(k) {
        if (k === " " || k === "Shift" || k === "Control") return true;
        if (k === "ArrowLeft" || k === "ArrowUp" ||
            k === "ArrowRight" || k === "ArrowDown") return true;
        return /^[a-z0-9]$/.test(k);
    }

    function copyKeymap(m) {
        var c = {};
        for (var i = 0; i < ACTION_ORDER.length; i++) {
            var a = ACTION_ORDER[i];
            c[a] = m[a].slice();
        }
        return c;
    }

    function loadKeymap() {
        var m = null;
        try {
            var raw = localStorage.getItem(KEYMAP_STORAGE);
            if (raw) m = JSON.parse(raw);
        } catch (e) { m = null; }
        if (m) {
            for (var i = 0; i < ACTION_ORDER.length; i++) {
                var a = ACTION_ORDER[i], b = m[a];
                if (!b || b.length < 1 || b.length > 2)
                    return copyKeymap(DEFAULT_KEYMAP);
                for (var j = 0; j < b.length; j++)
                    if (typeof b[j] !== "string" || !validKey(b[j]))
                        return copyKeymap(DEFAULT_KEYMAP);
            }
        }
        return m ? copyKeymap(m) : copyKeymap(DEFAULT_KEYMAP);
    }

    var keymap = loadKeymap();

    function saveKeymap() {
        try {
            localStorage.setItem(KEYMAP_STORAGE, JSON.stringify(keymap));
        } catch (e) { /* private mode etc: session-only keymap */ }
    }

    function notifyKeymap() {
        for (var i = 0; i < keymapListeners.length; i++)
            keymapListeners[i](copyKeymap(keymap));
    }

    function setBind(action, slot, key) {
        var a = ACTION_ORDER.indexOf(action);
        if (a < 0 || (slot !== 0 && slot !== 1) || !validKey(key))
            return copyKeymap(keymap);
        keymap[action][slot] = key;
        /* never allow the same key in both slots */
        var other = slot ? 0 : 1;
        if (keymap[action][other] === key)
            keymap[action] = [key];
        saveKeymap();
        notifyKeymap();
        return copyKeymap(keymap);
    }

    function clearBind(action, slot) {
        if (ACTION_ORDER.indexOf(action) < 0 || slot !== 1)
            return copyKeymap(keymap);
        if (keymap[action].length > 1) {
            keymap[action] = [keymap[action][0]];
            saveKeymap();
            notifyKeymap();
        }
        return copyKeymap(keymap);
    }

    function applyPreset(name) {
        var p = PRESETS[name];
        if (!p)
            return copyKeymap(keymap);
        for (var i = 0; i < ACTION_ORDER.length; i++) {
            var a = ACTION_ORDER[i];
            keymap[a] = p[a].slice();
        }
        saveKeymap();
        notifyKeymap();
        return copyKeymap(keymap);
    }

    /* {action, slot} while a slot is waiting for a new key (popup). */
    var capture = null;

    /* The action bound to this key event, or null.  Only a single key
     * press counts: a bound regular key must be pressed with no modifier
     * held, and a bound Shift/Control must be pressed alone.  Key
     * combinations (including caps/shift letters) never trigger an
     * action. */
    function keyAction(e) {
        var k = e.key;
        if (!k) return null;
        if (k.length === 1) k = k.toLowerCase();
        for (var i = 0; i < ACTION_ORDER.length; i++) {
            var a = ACTION_ORDER[i], b = keymap[a];
            for (var j = 0; j < b.length; j++) {
                if (b[j] !== k) continue;
                if (e.altKey || e.metaKey ||
                    (e.ctrlKey && k !== "Control") ||
                    (e.shiftKey && k !== "Shift"))
                    return null;
                return a;
            }
        }
        return null;
    }

    function passThroughCode(e) {
        var c = e.keyCode;
        if (c >= 65 && c <= 90) {            /* A-Z */
            return e.shiftKey ? c : c + 32;
        }
        return c;
    }

    function keyDownCode(e) {
        var c = e.keyCode;
        if (c === 13) return 256 + 13;       /* Enter  (256 + '\r') */
        if (c === 32) return 32;             /* space is always fire */
        if (inNameEntry()) {
            /* Name entry wants literal characters: ignore the arrow keys
             * (there is no cursor to move) and do not apply the keymap,
             * or typing bound keys would produce action codes instead of
             * the literal characters. */
            if (c >= 37 && c <= 40) return null;
            return passThroughCode(e);
        }
        var a = keyAction(e);
        if (a) return ACTION_GAME[a];
        return passThroughCode(e);
    }

    function keyUpCode(e) {
        var c = e.keyCode;
        if (c === 13) return 256 + 13;
        if (c === 32) return 32;             /* plain space, as X11 did */
        if (inNameEntry()) {
            if (c >= 37 && c <= 40) return null;
            return passThroughCode(e);
        }
        var a = keyAction(e);
        if (a) return ACTION_GAME[a];
        return passThroughCode(e);
    }

    var audio = {
        ctx: null,
        data: [],
        buffers: [],
        sources: [],
        unlocked: false,
        unlock: function () {
            if (!this.unlocked) {
                var AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) return;
                this.ctx = new AC();
                for (var i = 0; i < this.data.length; i++) {
                    var bytes = this.data[i];
                    var buf = this.ctx.createBuffer(1, bytes.length, 8000);
                    var ch = buf.getChannelData(0);
                    for (var j = 0; j < bytes.length; j++)
                        ch[j] = (bytes[j] - 128) / 128;
                    this.buffers.push(buf);
                }
                this.unlocked = true;
            }
            if (this.ctx.state === "suspended")
                this.ctx.resume().catch(function () {});
        },
        play: function (k) {
            if (!this.ctx || !this.buffers[k]) return;
            var s = this.ctx.createBufferSource();
            s.buffer = this.buffers[k];
            s.connect(this.ctx.destination);
            s.start(0);
            this.sources.push(s);
            s.onended = function () {
                var i = audio.sources.indexOf(s);
                if (i >= 0) audio.sources.splice(i, 1);
            };
        },
        stopAll: function () {
            for (var i = 0; i < this.sources.length; i++) {
                try { this.sources[i].stop(); } catch (e) {}
            }
            this.sources = [];
        }
    };

    var X = globalThis.__xgal = {
        canvas: null,
        ctx: null,
        img: null,
        audio: audio,
        pending: function () { return evq.length > 0; },
        popEvent: function () { return evq.length ? evq.shift() : 0; },
        pushExpose: function (idx) { pushEvent(1, 0, 0, idx); },
        /* --- keymap API (used by settings_ui.js) --- */
        keymap: function () { return copyKeymap(keymap); },
        setBind: function (action, slot, key) {
            return setBind(action, slot, key);
        },
        clearBind: function (action, slot) {
            return clearBind(action, slot);
        },
        applyPreset: function (name) {
            return applyPreset(name);
        },
        startCapture: function (action, slot) {
            if (ACTION_ORDER.indexOf(action) < 0 ||
                (slot !== 0 && slot !== 1))
                return false;
            capture = { action: action, slot: slot };
            return true;
        },
        cancelCapture: function () { capture = null; },
        captureActive: function () { return !!capture; },
        onKeymapChange: function (fn) { keymapListeners.push(fn); },
        getMouse: function () {
            return ((mouse.x & 0x3FF) << 1) |
                ((mouse.y & 0x3FF) << 17) |
                (mouse.down ? 1 : 0);
        },
        toGame: function (e) {
            var r = canvas.getBoundingClientRect();
            return {
                x: Math.max(0, Math.min(canvas.width - 1,
                    Math.round((e.clientX - r.left) * canvas.width / r.width))),
                y: Math.max(0, Math.min(canvas.height - 1,
                    Math.round((e.clientY - r.top) * canvas.height / r.height)))
            };
        },
        attach: function (c) {
            canvas = c;
            X.canvas = c;

            document.addEventListener('keydown', function (e) {
                if (capture) {
                    /* A key-settings slot is waiting for a key: consume
                     * everything so the game never sees it. */
                    e.preventDefault();
                    var k = e.key;
                    if (k === "Escape") {
                        capture = null;
                        notifyKeymap();
                        return;
                    }
                    if (k.length === 1) k = k.toLowerCase();
                    if (validKey(k) &&
                        !e.altKey && !e.metaKey &&
                        !(e.ctrlKey && k !== "Control") &&
                        !(e.shiftKey && k !== "Shift")) {
                        setBind(capture.action, capture.slot, k);
                        capture = null;
                    }
                    return;
                }
                if (e.keyCode === 32 || e.keyCode === 13 ||
                    (e.keyCode >= 37 && e.keyCode <= 40))
                    e.preventDefault();
                audio.unlock();
                var code = keyDownCode(e);
                if (code !== null)
                    pushEvent(2, code, 0, 0, 0);
            });
            document.addEventListener('keyup', function (e) {
                if (capture) return;
                pushEvent(4, keyUpCode(e), 0, 0, 0);
            });

            /* Browsers stop delivering keyup once the page loses focus, so
             * without this the C-side key state (static `keys` in do_player)
             * keeps a movement key held: e.g. holding J and alt-tabbing
             * away, then back, leaves the ship drifting left.  Synthesize
             * releases for the four game-control keys (ctrl-b, ctrl-f,
             * space, 'x'). */
            function releaseHeldKeys() {
                var codes = [226, 230, 32, 120];
                for (var i = 0; i < codes.length; i++)
                    pushEvent(4, codes[i], 0, 0, 0);
            }
            window.addEventListener('blur', function () {
                if (capture) {
                    capture = null;
                    notifyKeymap();
                }
                releaseHeldKeys();
            });
            document.addEventListener('visibilitychange', function () {
                if (document.hidden)
                    releaseHeldKeys();
            });

            c.addEventListener('mousemove', function (e) {
                var p = X.toGame(e);
                mouse.x = p.x;
                mouse.y = p.y;
            });
            c.addEventListener('mousedown', function (e) {
                e.preventDefault();
                audio.unlock();
                if (e.button === 0) {
                    var p = X.toGame(e);
                    mouse.x = p.x;
                    mouse.y = p.y;
                    mouse.down = true;
                    pushEvent(3, 1, p.x, p.y, 0);
                }
            });
            window.addEventListener('mouseup', function (e) {
                if (e.button === 0) mouse.down = false;
            });
            c.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        }
    };

    /* Game exit (Q / Shift-Q): the original xgal_exit() terminates the
     * process and the window disappears.  The closest browser equivalent
     * is closing the tab; when the browser refuses (tabs the user opened
     * can't be closed by script), say so so the user can close it. */
    var exited = false;
    function doExit() {
        if (exited) return;
        exited = true;
        try { audio.stopAll(); } catch (e) {}
        try { window.close(); } catch (e) {}
        setTimeout(function () {
            if (!document.body) return;
                var d = document.createElement('div');
                d.style.cssText =
                    'position:fixed;left:0;top:0;right:0;bottom:0;' +
                    'background:#000;color:#0f0;font-family:monospace;' +
                    'font-size:18px;display:flex;align-items:center;' +
                    'justify-content:center;z-index:9999;';
                d.textContent = 'Game exited - you can close this tab.';
                document.body.appendChild(d);
        }, 200);
    }
    var M = typeof Module !== 'undefined' ? Module : (globalThis.Module = {});
    M.onExit = doExit;
    /* --- shared high-score leaderboard (self-hosted API) -----------------
     * The "global" board is a small always-on server (leaderboard.py) that
     * also serves this page, so the API is same-origin /scores by default.
     * Override the origin with window.XGAL_LEADERBOARD_URL in index.html.
     *
     * On load: fetch the board, write it into the global score file the C
     * side reads (SCOREFILE = /tmp/xgal_global_scores) in its binary format
     * (per entry: 20-byte name + 4-byte big-endian score + 4-byte big-endian
     * level, NUM_GLOBAL_SCORES=20 entries), then ask C to reload the arrays.
     * On a new high score: C's xgal_web_submit() calls __xgalSubmit to POST. */
    var LB_N = 20;                 /* NUM_GLOBAL_SCORES (web, highscore.c) */
    var LB_ENTRY = 28;             /* 20-byte name + 4-byte score + 4-byte level */
    var LB_FILE = '/tmp/xgal_global_scores'; /* == SCOREFILE (web/config.h) */

    function lbScoresUrl() {
        var base = String(globalThis.XGAL_LEADERBOARD_URL || '').replace(/\/+$/, '');
        return base + '/scores';
    }

    function lbRefresh() {
        try {
            if (typeof M._xgal_web_refresh === 'function') { M._xgal_web_refresh(); return; }
            if (typeof M.xgal_web_refresh === 'function') { M.xgal_web_refresh(); return; }
            if (M.capi && typeof M.capi.xgal_web_refresh === 'function') { M.capi.xgal_web_refresh(); return; }
            if (M.ccall) M.ccall('xgal_web_refresh', null, [], []);
        } catch (e) { console.warn('leaderboard refresh failed', e); }
    }

    function lbLoadBoard() {
        fetch(lbScoresUrl(), { headers: { 'Accept': 'application/json' } })
            .then(function (r) { return r.ok ? r.json() : []; })
            .then(function (list) {
                var FS = (window.FS || M.FS);
                if (!FS || typeof FS.writeFile !== 'function') return;
                list = Array.isArray(list) ? list : [];
                var buf = new Uint8Array(LB_N * LB_ENTRY);
                for (var i = 0; i < LB_N; i++) {
                    var e = list[i] || {};
                    var name = String(e.name || '');
                    for (var c = 0; c < 20; c++)
                        buf[i * LB_ENTRY + c] = c < name.length ? (name.charCodeAt(c) & 0xff) : 0;
                    var s = e.score | 0, l = e.level | 0, o = i * LB_ENTRY + 20;
                    buf[o + 0] = (s >>> 24) & 0xff; buf[o + 1] = (s >>> 16) & 0xff;
                    buf[o + 2] = (s >>> 8) & 0xff; buf[o + 3] = s & 0xff;
                    buf[o + 4] = (l >>> 24) & 0xff; buf[o + 5] = (l >>> 16) & 0xff;
                    buf[o + 6] = (l >>> 8) & 0xff; buf[o + 7] = l & 0xff;
                }
                FS.writeFile(LB_FILE, buf);
                lbRefresh();
            })
            .catch(function (e) { console.warn('leaderboard load failed', e); });
    }

    globalThis.__xgalSubmit = function (name, score, level) {
        try {
            fetch(lbScoresUrl(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: String(name).slice(0, 20), score: score, level: level })
            }).then(function (r) {
                if (!r.ok) console.warn('leaderboard POST status', r.status);
            }).catch(function (e) { console.warn('leaderboard POST failed', e); });
        } catch (e) { console.warn('leaderboard submit error', e); }
    };

    var _origRTI = M.onRuntimeInitialized;
    M.onRuntimeInitialized = function () {
        if (typeof _origRTI === 'function') _origRTI();
        lbLoadBoard();
    };
})();

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

    function keyDownCode(e) {
        var c = e.keyCode;
        if (c === 13) return 256 + 13;       /* Enter  (256 + '\r') */
        if (c === 37) return 226;            /* Left arrow  -> ctrl-b (98+128) */
        if (c === 39) return 230;            /* Right arrow -> ctrl-f (102+128) */
        if (c === 32) return 32;             /* space */
        if (c === 74) return 226;            /* J = move left  -> ctrl-b */
        if (c === 76) return 230;            /* L = move right -> ctrl-f */
        if (c === 70) return 32;             /* F = fire        -> space */
        if (c === 68) return 120;            /* D = shield      -> 'x' */
        if (c >= 65 && c <= 90) {            /* A-Z */
            if (e.ctrlKey) return (c + 32) + 128;
            return e.shiftKey ? c : c + 32;
        }
        return c;
    }

    function keyUpCode(e) {
        var c = e.keyCode;
        if (c === 13) return 256 + 13;
        if (c === 32) return 32;             /* plain space, as X11 did */
        if (c === 37 || c === 74) return 226;   /* left (arrow, J) */
        if (c === 39 || c === 76) return 230;   /* right (arrow, L) */
        if (c === 70) return 32;             /* F release -> space */
        if (c === 68) return 120;            /* D release -> 'x' */
        if (c === 102 || c === 98) return c + 128;  /* 'f', 'b' releases */
        return c;
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
        pushExpose: function (idx) { pushEvent(1, 0, 0, 0, idx); },
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
                if (e.keyCode === 32 || e.keyCode === 13 ||
                    (e.keyCode >= 37 && e.keyCode <= 40) ||
                    (e.ctrlKey && (e.keyCode === 70 || e.keyCode === 66)))
                    e.preventDefault();
                audio.unlock();
                pushEvent(2, keyDownCode(e), 0, 0, 0);
            });
            document.addEventListener('keyup', function (e) {
                pushEvent(4, keyUpCode(e), 0, 0, 0);
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
})();

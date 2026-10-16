/* debug_webui.js — in-browser debug panel for the xgalaga-hyperspace web
 * build.
 *
 * Shown only when debug mode is enabled:
 *   - the page sets window.XGAL_DEBUG_WEBUI = true (see index.html), or
 *   - the URL contains ?debug
 *
 * The panel (to the right of the game canvas) polls the exported C state
 * (xgal_web_debug_state) and exposes setters for: start level + new game,
 * weapon type, min torps, ships, shields, ship speed, and pause.  The
 * setters run between game-loop frames on the single emscripten thread, so
 * they work paused or unpaused.
 */
(function () {
    "use strict";

    function debugEnabled() {
        return window.XGAL_DEBUG_WEBUI === true ||
               /[?&]debug\b/.test(location.search);
    }
    if (!debugEnabled())
        return;

    var WEAPONS = ["Single", "Double", "Triple", "Spread", "Machine"];
    var SHIELDTIME = 400; /* web build defs.h: ticks per full shield */
    var N_SLOTS = 18;

    var M = null;
    var stateAddr = null;
    var el = {};           /* readout elements */
    var lastTick = null, lastTickTime = null, lastFpsTime = null;
    var rafFrames = 0;
    var simHz = 0, fps = 0;

    /* --- C bridge -------------------------------------------------------- */

    function moduleReady() {
        M = (typeof Module !== "undefined") ? Module : null;
        return !!(M && M._xgal_web_debug_state && M._malloc);
    }

    function readState() {
        M._xgal_web_debug_state(stateAddr);
        return new Int32Array(M.HEAPU8.buffer, stateAddr, N_SLOTS);
    }

    function shieldIcons(ticks) {
        if (ticks <= 0)
            return 0;
        /* mirrors the C bar formula (integer arithmetic): */
        /* total = (ticks*19/SHIELDTIME)+1, icons = ceil(total/19) */
        var total = Math.floor((ticks * 19) / SHIELDTIME) + 1;
        var n = 0;
        while (total > 0) {
            n++;
            total -= 19;
        }
        return n;
    }

    /* --- panel ----------------------------------------------------------- */

    function kv(label, id) {
        var s = document.createElement("span");
        s.innerHTML = label + " <b id=\"xgd-" + id + "\">-</b>";
        s.style.cssText = "display:flex;justify-content:space-between";
        return s;
    }

    function buildPanel() {
        stateAddr = M._malloc(N_SLOTS * 4);
        requestAnimationFrame(function raf() {
            rafFrames++;
            requestAnimationFrame(raf);
        });

        var panel = document.createElement("div");
        panel.id = "xgal-debug";
        panel.style.cssText =
            "width:272px;margin-left:16px;padding:6px 10px;background:#111;" +
            "border:1px solid #444;color:#9f9;font:12px monospace;" +
            "box-sizing:border-box;align-self:flex-start";

        var ro = document.createElement("div");
        ro.style.cssText = "display:flex;flex-direction:column;gap:2px;width:100%";
        ro.appendChild(kv("LVL", "lvl"));
        ro.appendChild(kv("META", "meta"));
        ro.appendChild(kv("SCORE", "score"));
        ro.appendChild(kv("SHIPS", "ships"));
        ro.appendChild(kv("MinTorps", "maxt"));
        ro.appendChild(kv("TORPS", "torps"));
        ro.appendChild(kv("ETORPS", "etorps"));
        ro.appendChild(kv("SPEED", "speed"));
        ro.appendChild(kv("SHLD", "shld"));
        ro.appendChild(kv("ALIENS", "aliens"));
        ro.appendChild(kv("STARSPD", "stars"));
        ro.appendChild(kv("STATE", "state"));
        ro.appendChild(kv("SIM", "sim"));
        ro.appendChild(kv("FPS", "fps"));
        panel.appendChild(ro);

        function numInput(id, min, max, value) {
            var i = document.createElement("input");
            i.id = id;
            i.type = "number";
            i.min = min;
            i.max = max;
            i.value = value;
            i.style.cssText = "width:48px;background:#000;color:#9f9;" +
                              "border:1px solid #444;font:12px monospace";
            return i;
        }
        function button(id, label, handler) {
            var b = document.createElement("button");
            b.id = id;
            b.textContent = label;
            b.style.cssText = "background:#000;color:#9f9;border:1px solid #444;" +
                              "font:12px monospace;cursor:pointer;padding:1px 6px";
            b.addEventListener("click", handler);
            return b;
        }
        function row(parts) {
            var d = document.createElement("div");
            d.style.cssText = "display:flex;gap:6px;align-items:center";
            for (var i = 0; i < parts.length; i++)
                d.appendChild(parts[i]);
            panel.appendChild(d);
            return d;
        }
        function label(t) {
            var s = document.createElement("span");
            s.textContent = t;
            return s;
        }

        var lvlIn = numInput("xgd-startlvl", 1, 9999, 1);
        row([label("Start LVL:"), lvlIn,
             button("xgd-newgame", "New game", function () {
                 M._xgal_web_debug_start_game(
                     parseInt(lvlIn.value, 10) || 0);
             })]);

        var wsel = document.createElement("select"); wsel.id = "xgd-weapon";
        for (var w = 0; w < WEAPONS.length; w++) {
            var o = document.createElement("option");
            o.value = w;
            o.textContent = WEAPONS[w];
            wsel.appendChild(o);
        }
        wsel.style.cssText = "background:#000;color:#9f9;border:1px solid #444;" +
                             "font:12px monospace";
        wsel.addEventListener("change", function () {
            M._xgal_web_debug_set_weapon(parseInt(wsel.value, 10));
        });
        row([label("Weapon:"), wsel]);

        var mtIn = numInput("xgd-in-maxt", 1, 15, 3);
        row([label("MinTorps:"), mtIn,
             button("xgd-setmt", "Set", function () {
                 M._xgal_web_debug_set_maxtorps(parseInt(mtIn.value, 10) || 1);
             })]);

        var shIn = numInput("xgd-in-ships", 0, 10, 2);
        row([label("Ships:"), shIn,
             button("xgd-setships", "Set", function () {
                 M._xgal_web_debug_set_ships(parseInt(shIn.value, 10) || 0);
             })]);

        var sdIn = numInput("xgd-shields", 0, 8, 0);
        row([label("Shields:"), sdIn,
             button("xgd-setshld", "Set", function () {
                 M._xgal_web_debug_set_shields(parseInt(sdIn.value, 10) || 0);
             })]);

        var spIn = numInput("xgd-in-speed", 0, 4, 0);
        row([label("Speed prizes:"), spIn,
             button("xgd-setsp", "Set", function () {
                 M._xgal_web_debug_set_speed(parseInt(spIn.value, 10) || 0);
             })]);

        var pauseBtn = button("xgd-pause", "Pause", null);
        row([pauseBtn]);

        /* side layout: [canvas + links] in a left column, panel on the right */
        var canvas = document.getElementById("xgalcanvas");
        var links = document.getElementById("xgal-links");
        var varrow = document.createElement("div");
        varrow.id = "xgal-row";
        varrow.style.cssText =
            "display:flex;align-items:flex-start;justify-content:center";
        var left = document.createElement("div");
        left.id = "xgal-left";
        left.style.cssText =
            "display:flex;flex-direction:column;align-items:center";
        document.body.insertBefore(varrow, document.body.firstChild);
        left.appendChild(canvas);
        if (links)
            left.appendChild(links);
        varrow.appendChild(left);
        varrow.appendChild(panel);
        if (window.fitCanvas)
            window.fitCanvas();

        el = {
            lvl: document.getElementById("xgd-lvl"),
            meta: document.getElementById("xgd-meta"),
            score: document.getElementById("xgd-score"),
            ships: document.getElementById("xgd-ships"),
            maxt: document.getElementById("xgd-maxt"),
            torps: document.getElementById("xgd-torps"),
            etorps: document.getElementById("xgd-etorps"),
            speed: document.getElementById("xgd-speed"),
            shld: document.getElementById("xgd-shld"),
            aliens: document.getElementById("xgd-aliens"),
            stars: document.getElementById("xgd-stars"),
            state: document.getElementById("xgd-state"),
            sim: document.getElementById("xgd-sim"),
            fps: document.getElementById("xgd-fps")
        };

        setInterval(function () {
            update(lvlIn, wsel, mtIn, shIn, sdIn, spIn, pauseBtn);
        }, 250);
    }

    function update(lvlIn, wsel, mtIn, shIn, sdIn, spIn, pauseBtn) {
        var s;
        try {
            s = readState();
        } catch (e) {
            return;
        }
        var now = performance.now();
        if (lastTick !== null) {
            var dt = (now - lastTickTime) / 1000;
            if (dt > 0)
                simHz = Math.round((s[17] - lastTick) / dt);
        }
        lastTick = s[17];
        lastTickTime = now;
        if (lastFpsTime !== null) {
            var fdt = (now - lastFpsTime) / 1000;
            if (fdt > 0.2) {
                fps = Math.round(rafFrames / fdt);
                rafFrames = 0;
                lastFpsTime = now;
            }
        } else {
            lastFpsTime = now;
        }

        el.lvl.textContent = s[0];
        el.meta.textContent = s[1];
        el.score.textContent = s[2];
        el.ships.textContent = s[3];
        el.maxt.textContent = s[4];
        el.torps.textContent = s[5];
        el.etorps.textContent = s[6] + "/" + s[7];
        el.speed.textContent = (s[8] / 2).toFixed(1);
        el.shld.textContent = shieldIcons(s[9]);
        el.aliens.textContent = s[14];
        el.stars.textContent = s[13];
        el.state.textContent =
            s[12] ? "GAME OVER" : (s[11] ? "PAUSED" : "PLAYING");
        el.sim.textContent = simHz;
        el.fps.textContent = fps;

        /* keep the controls in sync when C changes the value elsewhere
         * (prize pickup, lemon, new game) */
        if (document.activeElement !== wsel)
            wsel.value = s[10];
        if (document.activeElement !== mtIn)
            mtIn.value = s[4];
        if (document.activeElement !== shIn)
            shIn.value = s[3];
        if (document.activeElement !== sdIn)
            sdIn.value = shieldIcons(s[9]);
        if (document.activeElement !== spIn)
            spIn.value = Math.min(4, Math.max(0, Math.floor(s[8] / 2 - 1)));
        if (document.activeElement !== lvlIn)
            lvlIn.value = s[16];
        pauseBtn.textContent = s[11] ? "Resume" : "Pause";
        pauseBtn.onclick = function () {
            M._xgal_web_debug_set_paused(s[11] ? 0 : 1);
        };
    }

    /* --- wait for the emscripten module ---------------------------------- */

    (function wait() {
        if (moduleReady())
            buildPanel();
        else
            setTimeout(wait, 200);
    })();
})();

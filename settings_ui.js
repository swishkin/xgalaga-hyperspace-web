/* settings_ui.js - key settings for the xgalaga-hyperspace web build.
 *
 * A gear icon below the game screen opens a small popup where the
 * move-left / move-right / fire / shield keybinds can be changed.  Each
 * action takes one or two single keys (letter, number, arrow key, space,
 * shift or control); key combinations are never accepted.  Two presets
 * are offered as one-click chips (wasd / arrow keys / ijkl).  The keymap
 * lives in webglue.js (localStorage "xgal-keymap-v1"); this file only
 * draws the UI and forwards user actions to the __xgal keymap API.
 */
(function () {
    "use strict";

    var X = globalThis.__xgal;
    if (!X || typeof X.keymap !== "function")
        return; /* game bundle without the keymap API */

    var ACTIONS = [
        { id: "left",   label: "Move left" },
        { id: "right",  label: "Move right" },
        { id: "fire",   label: "Fire" },
        { id: "shield", label: "Shield" }
    ];

    var KEY_LABEL = {
        "ArrowLeft": "\u2190", "ArrowRight": "\u2192",
            /* arrows */
        "ArrowUp": "\u2191", "ArrowDown": "\u2193",
        " ": "Space", "Shift": "Shift", "Control": "Ctrl"
    };

    function keyLabel(k) {
        return KEY_LABEL[k] || k.toUpperCase();
    }

    /* --- styles ----------------------------------------------------------- */

    var css = document.createElement("style");
    css.textContent =
        "#xgal-keys{margin-left:auto;background:none;border:none;cursor:pointer;" +
        "display:flex;align-items:center;padding:0}" +
        "#xgal-keys svg{fill:#777;display:block;margin-left:0}" +
        "#xgal-keys:hover svg{fill:#fff}" +
        "#xgal-keyset{position:fixed;top:0;left:0;right:0;bottom:0;z-index:10;" +
        "background:rgba(0,0,0,0.55)}" +
        "#xgal-keyset .box{position:absolute;top:50%;left:50%;transform:" +
        "translate(-50%,-50%);background:#111;border:1px solid #444;" +
        "color:#9f9;font:13px monospace;padding:12px 14px;box-sizing:border-box;" +
        "width:320px}" +
        "#xgal-keyset .head{display:flex;justify-content:space-between;" +
        "align-items:center;font-weight:bold;margin-bottom:10px}" +
        "#xgal-keyset .close{background:none;border:none;color:#9f9;cursor:" +
        "pointer;font:14px monospace;padding:0 2px}" +
        "#xgal-keyset .close:hover{color:#fff}" +
        "#xgal-keyset .presets{display:flex;gap:8px;margin-bottom:10px}" +
        "#xgal-keyset .chip{background:#000;color:#9f9;border:1px solid #444;" +
        "font:12px monospace;cursor:pointer;padding:3px 10px;border-radius:9px}" +
        "#xgal-keyset .chip:hover{color:#fff;border-color:#888}" +
        "#xgal-keyset .krow{display:flex;align-items:center;gap:8px;margin:5px 0}" +
        "#xgal-keyset .klabel{width:86px}" +
        "#xgal-keyset .slot{background:#000;color:#9f9;border:1px solid #444;" +
        "font:12px monospace;cursor:pointer;padding:3px 0;width:64px;" +
        "box-sizing:border-box;text-align:center;min-height:20px}" +
        "#xgal-keyset .slot:hover{color:#fff;border-color:#888}" +
        "#xgal-keyset .slot.empty{border-style:dashed;color:#555}" +
        "#xgal-keyset .slot.capturing{color:#ff0;border-color:#ff0}" +
        "#xgal-keyset .clear{background:none;border:none;color:#555;cursor:" +
        "pointer;font:12px monospace;padding:0 2px}" +
        "#xgal-keyset .clear:hover{color:#fff}" +
        "#xgal-keyset .hint{color:#666;font-size:11px;margin-top:8px}";
    document.head.appendChild(css);

    /* --- gear icon (right end of the links row) --------------------------- */

    var gear = document.createElement("button");
    gear.id = "xgal-keys";
    gear.title = "Key settings";
    gear.setAttribute("aria-label", "Key settings");
    gear.innerHTML =
        '<svg viewBox="0 0 24 24" width="18" height="18" ' +
        'xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<path d="M19.4 13c0-.3.1-.6.1-1s0-.7-.1-1l2.1-1.6c.2-.2.2-.4 0-.6' +
        'l-2-3.5c-.1-.2-.4-.3-.6-.2l-2.5 1c-.5-.4-1.1-.7-1.7-1l-.4-2.6c0-.2' +
        '-.2-.4-.5-.4h-4c-.2 0-.4.2-.5.4l-.4 2.6c-.6.3-1.2.6-1.7 1l-2.5-1' +
        'c-.2-.1-.5 0-.6.2l-2 3.5c-.1.2-.1.5.1.6L4.5 11c0 .3-.1.6-.1 1s0 .7.1' +
        ' 1l-2.1 1.6c-.2.2-.2.4 0 .6l2 3.5c.1.2.4.3.6.2l2.5-1c.5.4 1.1.7 1.7 1' +
        'l.4 2.6c0 .2.2.4.5.4h4c.2 0 .4-.2.5-.4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1' +
        'c.2.1.5 0 .6-.2l2-3.5c.1-.2.1-.5-.1-.6L19.4 13zM12 15.5c-1.9 0-3.5-1.6' +
        '-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5z"/></svg>';

    var links = document.getElementById("xgal-links");
    if (links)
        links.appendChild(gear);
    else
        document.body.appendChild(gear);

    /* --- popup ------------------------------------------------------------- */

    var overlay = null;
    var slotEls = {};   /* action -> [slot0 el, slot1 el, clear el] */

    function render() {
        if (!overlay) return;
        var km = X.keymap();
        for (var i = 0; i < ACTIONS.length; i++) {
            var a = ACTIONS[i], b = km[a.id];
            var els = slotEls[a.id];
            els[0].textContent = keyLabel(b[0]);
            els[0].className = "slot";
            if (b.length > 1) {
                els[1].textContent = keyLabel(b[1]);
                els[1].className = "slot";
                els[2].style.display = "";
            } else {
                els[1].textContent = "add key";
                els[1].className = "slot empty";
                els[2].style.display = "none";
            }
        }
    }

    function slotRow(action) {
        var d = document.createElement("div");
        d.className = "krow";

        var lab = document.createElement("span");
        lab.className = "klabel";
        lab.textContent = action.label;
        d.appendChild(lab);

        function makeSlot(slot) {
            var s = document.createElement("button");
            s.className = "slot";
            s.addEventListener("click", function () {
                X.startCapture(action.id, slot);
                render();
            });
            return s;
        }
        var s0 = makeSlot(0);
        var s1 = makeSlot(1);
        var clr = document.createElement("button");
        clr.className = "clear";
        clr.textContent = "\u00d7";
        clr.title = "Remove second key";
        clr.addEventListener("click", function () {
            X.clearBind(action.id, 1);
            render();
        });
        d.appendChild(s0);
        d.appendChild(s1);
        d.appendChild(clr);

        slotEls[action.id] = [s0, s1, clr];
        return d;
    }

    function presetChip(name, label, title) {
        var c = document.createElement("button");
        c.className = "chip";
        c.textContent = label;
        c.title = title;
        c.addEventListener("click", function () {
            X.applyPreset(name);
            render();
        });
        return c;
    }

    function buildOverlay() {
        overlay = document.createElement("div");
        overlay.id = "xgal-keyset";

        var box = document.createElement("div");
        box.className = "box";

        var head = document.createElement("div");
        head.className = "head";
        var h = document.createElement("span");
        h.textContent = "Key settings";
        var close = document.createElement("button");
        close.className = "close";
        close.textContent = "\u00d7";
        close.setAttribute("aria-label", "Close");
        close.addEventListener("click", closePopup);
        head.appendChild(h);
        head.appendChild(close);
        box.appendChild(head);

        var presets = document.createElement("div");
        presets.className = "presets";
        presets.appendChild(presetChip("wasd", "wasd",
            "a / d move, space fire, x shield"));
        presets.appendChild(presetChip("arrows",
            "\u2190\u2192", "arrow keys move, space fire, x shield"));
        presets.appendChild(presetChip("ijkl", "ijkl",
            "j / l move, f fire, d shield"));
        box.appendChild(presets);

        for (var i = 0; i < ACTIONS.length; i++)
            box.appendChild(slotRow(ACTIONS[i]));

        var hint = document.createElement("div");
        hint.className = "hint";
        hint.textContent =
            "Click a key slot, then press the key (Esc cancels). Letters," +
            " numbers, arrows, space, shift and ctrl. No combinations.";
        box.appendChild(hint);

        overlay.appendChild(box);
        overlay.addEventListener("click", function (e) {
            if (e.target === overlay)
                closePopup();
        });
        document.body.appendChild(overlay);
        render();
    }

    function openPopup() {
        if (X.captureActive())
            X.cancelCapture();
        if (!overlay)
            buildOverlay();
        else
            overlay.style.display = "";
        render();
    }

    function closePopup() {
        if (!overlay) return;
        X.cancelCapture();
        overlay.style.display = "none";
    }

    gear.addEventListener("click", function () {
        if (overlay && overlay.style.display !== "none")
            closePopup();
        else
            openPopup();
    });

    /* re-render the slots when a captured key lands or a preset is applied */
    X.onKeymapChange(function () { render(); });
})();

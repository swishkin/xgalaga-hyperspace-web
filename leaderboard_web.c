/* web/leaderboard_web.c
 *
 * Browser bridge for the shared high-score leaderboard. Compiled into the
 * emscripten (web) build only (guarded by __EMSCRIPTEN__); the native X11 build
 * never compiles any of this.
 *
 * Directions across the C/JS boundary:
 *   C -> JS:  xgal_web_submit() kicks off the JS fetch POST of a new score the
 *             moment it is committed in add_score() (highscore.c).
 *   JS -> C:  xgal_web_refresh() re-reads the global score file (which the JS
 *             layer populates from the API) into the in-game arrays so the
 *             title board renders the shared leaderboard.
 *   JS -> C:  xgal_web_getting_name() reports whether the "enter your name"
 *             prompt is active, so the JS input bridge passes literal
 *             characters during name entry instead of the game-control key
 *             remaps (f = fire, d = shield, j/l = move).
 *
 * Only <emscripten.h> is needed here. load_scores() is declared in proto.h and
 * getting_name in data.h, but those headers pull in Wlib types, so both are
 * declared locally to keep this translation unit free of them.
 */
#ifdef __EMSCRIPTEN__
#include <emscripten.h>

/* Defined in highscore.c (see proto.h). */
void load_scores(void);
/* Defined in data.c (see data.h). */
extern int getting_name;


/* Fire-and-forget. name is the entered name (<= 20 chars), score the final
 * score, level the level reached. The JS layer (webglue.js __xgalSubmit)
 * performs the actual fetch POST; we only hand it the values. */
EM_JS(void, xgal_web_submit, (const char *name, long score, long level), {
    /* EM_JS passes const char* params as raw heap pointers (numbers); the
     * JS body must UTF8ToString() it to get the actual name. */
    try {
        if (typeof __xgalSubmit === 'function') __xgalSubmit(UTF8ToString(name), score, level);
    } catch (e) {}
});

/* Called from JS after it has written the fetched leaderboard into the global
 * score file (SCOREFILE). Re-reads the score arrays so show_scores() displays
 * the shared board. Must stay free of any async suspension point (it is a
 * short, synchronous leaf under ASYNCIFY). */
void xgal_web_refresh(void)
{
    load_scores();
}

/* Called from the JS input bridge on every keydown to decide whether to apply
 * the game-control key remaps. Non-zero while the name prompt is up, in which
 * case the bridge types literal characters instead. Short, synchronous leaf:
 * safe to call from JS at any time under ASYNCIFY. */
EMSCRIPTEN_KEEPALIVE
int xgal_web_getting_name(void)
{
    return getting_name;
}
#endif

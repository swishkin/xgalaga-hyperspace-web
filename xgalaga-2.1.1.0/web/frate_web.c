/* frate_web.c - Frame rate control for the browser build.
 *
 * Replaces frate.c.  The original code blocks on a SIGALRM timer
 * (sigsuspend), which would freeze the browser's event loop.  Instead we
 * use emscripten_sleep(), which sleeps in small slices while dispatching
 * pending browser events (input handlers, canvas paint).  ~33 ms gives the
 * original 30 FPS.
 */
#include <emscripten.h>

void init_framerate(void)
{
}

void do_framerate(void)
{
    emscripten_sleep(33);
}

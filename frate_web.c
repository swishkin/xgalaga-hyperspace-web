/* frate_web.c - Frame rate control for the browser build.
 *
 * Replaces frate.c.  The original code blocks on a SIGALRM timer
 * (sigsuspend), which would freeze the browser's event loop.  Instead we
 * use emscripten_sleep(), which sleeps in small slices while dispatching
 * pending browser events (input handlers, canvas paint).  ~16 ms gives
 * ~60 FPS.  The game logic itself was retimed from the original 30 Hz
 * to 60 Hz: all per-tick speeds are halved and all frame-count timers
 * doubled, so wall-clock speed is identical to the original build.
 */
#include <emscripten.h>

void init_framerate(void)
{
}

void do_framerate(void)
{
    emscripten_sleep(16);
}

/* joystick_web.c - Joystick stubs for the browser build.
 *
 * Replaces linux-joystick.c, which is compiled out off Linux (__linux__
 * is not defined by Emscripten).  The game references js_device and the
 * joystick entry points, so they are provided as no-ops.
 */
#include "data.h"
#include "struct.h"

struct js_state js_curstate;
int js_device = 0;

void init_joystick(void)
{
}

void do_joystick(int *x, int *y, int *but)
{
    (void)x;
    (void)y;
    (void)but;
}

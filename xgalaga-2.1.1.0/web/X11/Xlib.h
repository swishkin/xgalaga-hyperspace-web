/* Minimal X11 type shim for the Emscripten (browser) build of xgalaga.
 *
 * The original libsprite library is X11-based and is not used here; the web
 * backend (wlib_web.c) implements the same W_ API on an HTML canvas.  This
 * header only provides the X11 types that Wlib.h references so the original
 * headers compile unchanged under emcc.
 */
#ifndef _XLIB_WEB_SHIM_H
#define _XLIB_WEB_SHIM_H

typedef unsigned long Pixmap;
typedef unsigned long Window;
typedef unsigned long Atom;
typedef unsigned long Cursor;
typedef unsigned long Font;
typedef unsigned long Colormap;
typedef unsigned long GC;
typedef unsigned long Status;
typedef unsigned long Time;
typedef unsigned long KeySym;
typedef int Bool;

typedef struct {
    unsigned long red;
    unsigned long green;
    unsigned long blue;
    unsigned long pixels;
} XColor;

struct _XDisplay;
typedef struct _XDisplay *Display;
struct _XScreen;
typedef struct _XScreen *Screen;
struct _XVisual;
typedef struct _XVisual *Visual;
struct _XFontStruct;
typedef struct _XFontStruct *XFontStruct;

#endif /* _XLIB_WEB_SHIM_H */

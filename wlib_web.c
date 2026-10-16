/* wlib_web.c - Browser backend for the xgalaga Wlib (libsprite) API.
 *
 * The original libsprite library is X11-based and cannot run in a browser.
 * This file re-implements the subset of the W_ API that xgalaga-hyperspace
 * uses, on top of an in-process software framebuffer that is blitted once
 * per frame to an HTML <canvas>.  Input events are produced by webglue.js
 * and consumed through W_EventsPending()/W_NextEvent().
 *
 * Semantics follow the X11 implementation in libsprite/:
 *   - Text uses the original X11 6x13 core font (see fontdata.h).  The
 *     caller's y is the line top; X11 draws at the baseline (y + ascent),
 *     so glyph row r lands on line y + r.  All drawing is clipped to the
 *     owning window rectangle, as the X server does.
 *   - W_MaskText draws only the glyph bits (XDrawString); W_WriteText fills
 *     each cell background black first, then draws the glyphs
 *     (XDrawImageString).
 *   - W_DrawImage: color (XPM) images draw their own colors, 1-bit images
 *     are tinted with the W_Color argument; when useOR is set, sprite
 *     pixels are OR'd onto the destination instead of replacing it.
 *   - Keyboard events use the same key encoding as libsprite/event.c:
 *     plain char, char+128 with Control (or repeat/arrow mapping),
 *     char+256 with Alt.  W_EV_KEY_OFF carries the released key.
 *   - W_GetMouse returns the absolute pointer position relative to the
 *     window plus the left button state.
 */
#include <emscripten.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "Wlib.h"
#include "fontdata.h"
#include "bigfontdata.h"

/* ---- globals normally provided by libsprite/data.c ---------------------- */

int xpm = 1, useOR = 1, useClipMask = 1, useBuffered = 1;
int autoPoint = 0, W_KeyDepth = 0, animPointers = 0, useWorkbench = 0;
unsigned long w_socket = 0;
int W_FastClear = 0;
int backColor = 0;

W_Font W_BigFont = (W_Font)0;
W_Font W_RegularFont = (W_Font)1;

/* Color indices (same layout as libsprite/defs.h: WHITE=0 ... LIGHT_GREY=7). */
W_Color W_White = 0, W_Black = 1, W_Red = 2, W_Green = 3, W_Yellow = 4,
        W_Cyan = 5, W_DarkGrey = 6, W_Grey = 7;

int W_Textwidth = 6, W_Textheight = FONT_ROWS;
int W_BigTextwidth = BIGFONT_MAXADV, W_BigTextheight = BIGFONT_HEIGHT;

/* TrueColor values from libsprite/data.c colortable (XParseColor names):
 * white, black, red, green, yellow, cyan, "#ffff00" (dark grey is really
 * yellow; it only cycles on 8-bit displays), "#c8c8c8" (light grey).
 * Stored as 0xBBGGRR because the canvas ImageData is little-endian RGBA. */
static unsigned int palette[8] = {
    0xFFFFFF, 0x000000, 0x0000FF, 0x00FF00,
    0x00FFFF, 0xFFFF00, 0x00FFFF, 0xC8C8C8
};

/* libsprite/color.c W_SetRGB16: the 8-bit-display palette cycler used by
 * show_scores() to make the highlighted score row blink.  On a display
 * without 8 planes (i.e. TrueColor, which is what we emulate) the
 * original returns immediately, leaving W_DarkGrey at its colortable
 * value (#FFFF00) - so the highlight is solid yellow, not random colors. */
void W_SetRGB16(W_Color color, int r, int g, int b)
{
    (void)color; (void)r; (void)g; (void)b;
}



/* ---- JS glue functions (implemented in webglue.js) ----------------------- */

EM_JS(void, js_canvas_init, (unsigned int w, unsigned int h), {
    const c = document.getElementById("xgalcanvas");
    c.width = w;
    c.height = h;
    globalThis.__xgal.attach(c);
});

EM_JS(void, js_upload_frame, (unsigned char *buf, unsigned int n), {
    const X = globalThis.__xgal;
    const H = (typeof HEAPU8 !== "undefined") ? HEAPU8 : Module.HEAPU8;
    if (!X.ctx)
        X.ctx = X.canvas.getContext("2d");
    if (!X.img || X.img.width !== X.canvas.width || X.img.height !== X.canvas.height)
        X.img = X.ctx.createImageData(X.canvas.width, X.canvas.height);
    new Uint32Array(X.img.data.buffer)
        .set(new Uint32Array(H.buffer, buf, n));
    X.ctx.putImageData(X.img, 0, 0);
});

EM_JS(void, js_push_expose, (int idx), {
    globalThis.__xgal.pushExpose(idx);
});

EM_JS(int, js_events_pending, (), {
    return globalThis.__xgal.pending() ? 1 : 0;
});

EM_JS(long long, js_event_pop, (), {
    return BigInt(globalThis.__xgal.popEvent());
});

EM_JS(long long, js_get_mouse, (), {
    return BigInt(globalThis.__xgal.getMouse());
});



/* ---- framebuffer and windows -------------------------------------------- */

static unsigned int *fb = 0;
static unsigned int FW = 0, FH = 0;

typedef struct {
    int x, y, w, h;
    int idx;
    int buffered;
} webwin_t;

static webwin_t wins[8];
static int nwins = 0;

static webwin_t *win_of(W_Window window)
{
    return (webwin_t *)window;
}

static void upload_frame(void)
{
    js_upload_frame((unsigned char *)fb, FW * FH);
}

/* ---- pixel primitives ---------------------------------------------------- */

/* Pixel writes are clipped to the owning window rectangle, like the X
 * server, so drawing from one window (e.g. baseWin sprites entering from
 * the top) can never touch another window's area (the score strip).
 * win == NULL addresses the whole framebuffer. */

static inline void putpx(webwin_t *win, int ax, int ay, unsigned int rgb)
{
    if (win) {
        if ((unsigned int)(ax - win->x) >= (unsigned int)win->w) return;
        if ((unsigned int)(ay - win->y) >= (unsigned int)win->h) return;
    }
    if ((unsigned int)ax < FW && (unsigned int)ay < FH)
        fb[ay * FW + ax] = 0xFF000000u | rgb;
}

static void fillrgb(webwin_t *win, int ax, int ay, int w, int h, unsigned int rgb)
{
    int x0 = ax, y0 = ay, x1 = ax + w, y1 = ay + h;
    if (win) {
        int wx0 = win->x, wy0 = win->y;
        if (x0 < wx0) x0 = wx0;
        if (y0 < wy0) y0 = wy0;
        if (x1 > wx0 + win->w) x1 = wx0 + win->w;
        if (y1 > wy0 + win->h) y1 = wy0 + win->h;
    }
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > (int)FW) x1 = (int)FW;
    if (y1 > (int)FH) y1 = (int)FH;
    for (int y = y0; y < y1; y++) {
        unsigned int *row = &fb[y * FW + x0];
        int n = x1 - x0;
        for (int i = 0; i < n; i++)
            row[i] = 0xFF000000u | rgb;
    }
}

static void fillpal(webwin_t *win, int ax, int ay, int w, int h, W_Color color)
{
    fillrgb(win, ax, ay, w, h, palette[color]);
}

static void draw_line(webwin_t *win, int x0, int y0, int x1, int y1, W_Color color)
{
    int dx = x1 > x0 ? x1 - x0 : x0 - x1, sx = x0 < x1 ? 1 : -1;
    int dy = y1 > y0 ? y1 - y0 : y0 - y1, sy = y0 < y1 ? 1 : -1;
    int err = dx - dy;
    for (;;) {
        putpx(win, win->x + x0, win->y + y0, palette[color]);
        if (x0 == x1 && y0 == y1) break;
        int e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
    }
}

/* ---- text ---------------------------------------------------------------- */

static void draw_glyph(webwin_t *win, int ax, int ay, unsigned char ch, unsigned int rgb)
{
    if ((int)ch < 32 || (int)ch >= 127) return;
    const unsigned char *g = font6x13[ch - 32];
    for (int row = 0; row < FONT_ROWS; row++) {
        unsigned int bits = g[row];
        for (int col = 0; col < 6; col++) {
            if (!(bits & (1u << (5 - col)))) continue;
            putpx(win, ax + col, ay + row, rgb);
        }
    }
}

/* Proportional big font (Helvetica Bold 34 bitmap table, bigfontdata.h):
 * the original X server advances the pen by each glyph's own advance
 * (XDrawString/XTextWidth), so "LEVEL N" matches the original's spacing.
 * The caller's y is the cell top (baseline - BIGFONT_ASCENT), as with the
 * core font. */
static void draw_text_big(webwin_t *win, int x, int y, W_Color color, char *str, int len)
{
    int pen = 0;
    unsigned int rgb = palette[color];

    for (int i = 0; i < len; i++) {
        unsigned char ch = (unsigned char)str[i];
        if ((int)ch < 32 || (int)ch >= 127) {
            pen += W_Textwidth;
            continue;
        }
        const bigglyph_t *g = &bigfont_glyph[ch - 32];
        if (g->w) {
            for (int r = 0; r < (int)g->h; r++) {
                const unsigned char *row =
                    &bigfont_rows[g->rowofs + r * ((g->w + 7) / 8)];
                for (int c = 0; c < (int)g->w; c++) {
                    if (!(row[c >> 3] & (0x80u >> (c & 7))))
                        continue;
                    putpx(win, win->x + x + pen + c, win->y + y + (int)g->dy + r, rgb);
                }
            }
        }
        pen += g->adv;
    }
}

static void draw_text(webwin_t *win, int x, int y, W_Color color, char *str, int len, W_Font font)
{
    if (font == W_BigFont) {
        draw_text_big(win, x, y, color, str, len);
        return;
    }
    /* X11 draws at the baseline (y + ascent); the line top is the caller's
     * y, so glyph row r lands on line y + r (row FONT_BASELINE = baseline). */
    for (int i = 0; i < len; i++)
        draw_glyph(win, win->x + x + i * W_Textwidth, win->y + y,
                   (unsigned char)str[i], palette[color]);
}

/* ---- image decoding ------------------------------------------------------ */

#define TRANSPARENT 255u

typedef struct {
    W_Image *image;
    int w, h, h_total, frames;
    int num_views;         /* XPMEXT num_views; 0 = not present */
    unsigned char *pix;    /* palette index per pixel, w*h*frames */
    unsigned int *pal;     /* rgb values for the image palette */
    int color_image;       /* 1: draw in own colors, 0: tint with W_Color */
} decimg_t;

static decimg_t decimgs[64];
static int ndecimgs = 0;

static decimg_t *dec_of(W_Image *image)
{
    for (int i = 0; i < ndecimgs; i++)
        if (decimgs[i].image == image)
            return &decimgs[i];
    return 0;
}

static int hexval(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return 0;
}

/* Parse an XPM string array.  Returns 0 on success.
 *
 * XPMEXT handling: when the header carries an XPMEXT marker, extension
 * lines ("MARKER name" followed by a value line) may be interleaved among
 * the color definitions (counted in ncolors, per the XPM format) or
 * appended after them (as in this game's shipped XPMs).  num_views/nviews
 * sets the animation frame count, exactly like libsprite/image.c does via
 * libXpm.  8-digit #AARRGGBB colors are supported; alpha 0 is transparent.
 */
static int decode_xpm(decimg_t *d, char **xpmdata)
{
    int w, h, ncolors, cpp;
    char marker[32] = "";
    char *line = xpmdata[0];

    if (sscanf(line, "%d %d %d %d %31s", &w, &h, &ncolors, &cpp, marker) < 4)
        return 1;
    if (ncolors <= 0 || ncolors > 256 || cpp < 1 || cpp > 2)
        return 1;

    d->w = w;
    d->num_views = 0;

    unsigned int *pal = malloc(ncolors * sizeof(*pal));
    unsigned char *keymap = malloc(256);
    unsigned char *none = malloc(ncolors);
    memset(keymap, 0xFF, 256);
    if (!pal || !keymap || !none) return 1;
    for (int i = 0; i < ncolors; i++) none[i] = 0;

    int mlen = (int)strlen(marker);
    int li = 1;

    static const char *ext_names[] = { "num_views", "nviews" };
    #define IS_EXT_LINE(s) (mlen > 0 && strncmp((s), marker, mlen) == 0 && \
        ((s)[mlen] == ' ' || (s)[mlen] == '\t' || (s)[mlen] == 0))

    int i = 0;
    while (i < ncolors) {
        char *p = xpmdata[li];
        if (IS_EXT_LINE(p)) {
            char *name = p + mlen;
            while (*name == ' ' || *name == '\t') name++;
            li += 2;
            if (li > 1 + ncolors + 16) return 1;
            char *val = xpmdata[li - 1];
            for (int e = 0; e < 2; e++)
                if (strncmp(name, ext_names[e], strlen(ext_names[e])) == 0)
                    d->num_views = atoi(val);
            i++;
            continue;
        }
        char key[3] = {0, 0, 0};
        int n = 0;
        while (*p && *p != ' ' && *p != '\t' && n < cpp)
            key[n++] = *p++;
        key[n] = 0;
        while (*p == ' ' || *p == '\t') p++;
        if (*p != 'c') return 1;
        p++;
        while (*p == ' ' || *p == '\t') p++;

        if (strcmp(p, "None") == 0) {
            pal[i] = 0;
            none[i] = 1;
        } else if (*p == '#') {
            p++;
            int len = (int)strlen(p);
            int r, g, b;
            if (len == 8) {
                int alpha = hexval(p[0]) * 16 + hexval(p[1]);
                r = hexval(p[2]) * 16 + hexval(p[3]);
                g = hexval(p[4]) * 16 + hexval(p[5]);
                b = hexval(p[6]) * 16 + hexval(p[7]);
                if (alpha == 0) {
                    pal[i] = 0;
                    none[i] = 1;
                } else {
                    pal[i] = r | (g << 8) | (b << 16);
                }
            } else if (len == 12) {
                /* This game's XPMs write each RRGGBB byte twice:
                 * "#FFFF00000000" means #FF0000.  (libXpm renders them
                 * this way; verified against the X11 build under Xvfb.) */
                r = hexval(p[0]) * 16 + hexval(p[1]);
                g = hexval(p[4]) * 16 + hexval(p[5]);
                b = hexval(p[8]) * 16 + hexval(p[9]);
                pal[i] = r | (g << 8) | (b << 16);
            } else if (len == 6) {
                r = hexval(p[0]) * 16 + hexval(p[1]);
                g = hexval(p[2]) * 16 + hexval(p[3]);
                b = hexval(p[4]) * 16 + hexval(p[5]);
                pal[i] = r | (g << 8) | (b << 16);
            } else if (len == 3) {
                r = hexval(p[0]) * 17;
                g = hexval(p[1]) * 17;
                b = hexval(p[2]) * 17;
                pal[i] = r | (g << 8) | (b << 16);
            } else {
                return 1;
            }
        } else {
            pal[i] = 0xFFFFFF; /* unknown color name; use white */
        }
        for (int j = 0; j < n; j++)
            keymap[(unsigned char)key[j]] = (unsigned char)i;
        i++;
        li++;
    }
    /* Extensions appended after the color definitions (not counted in
     * ncolors) appear between the colors and the pixel rows. */
    while (li <= 1 + ncolors + 16 && IS_EXT_LINE(xpmdata[li])) {
        char *name = xpmdata[li] + mlen;
        while (*name == ' ' || *name == '\t') name++;
        li += 2;
        if (li > 1 + ncolors + 16) return 1;
        char *val = xpmdata[li - 1];
        for (int e = 0; e < 2; e++)
            if (strncmp(name, ext_names[e], strlen(ext_names[e])) == 0)
                d->num_views = atoi(val);
    }

    unsigned char *pix = malloc((size_t)w * h);
    if (!pix) return 1;

    for (int y = 0; y < h; y++) {
        const char *row = xpmdata[li + y];
        for (int x = 0; x < w; x++) {
            int idx;
            if (cpp == 1)
                idx = keymap[(unsigned char)row[x]];
            else
                idx = keymap[(unsigned char)row[2 * x]];
            if (idx == 255 || none[idx])
                pix[y * w + x] = TRANSPARENT;
            else
                pix[y * w + x] = (unsigned char)idx;
        }
    }
    /* This game's XPMs place the XPMEXT extension block at the end of the
     * array (after the pixel rows, before the XPMENDEXT sentinel); the
     * standard format puts it among the color lines (handled above). */
    if (mlen > 0) {
        for (int e = 0; e < 16; e++) {
            char *s = xpmdata[li + h + e];
            if (!s || strcmp(s, "XPMENDEXT") == 0) break;
            if (IS_EXT_LINE(s)) {
                char *name = s + mlen;
                while (*name == ' ' || *name == '\t') name++;
                e++;
                char *val = xpmdata[li + h + e];
                for (int k = 0; k < 2; k++)
                    if (strncmp(name, ext_names[k], strlen(ext_names[k])) == 0)
                        d->num_views = atoi(val);
            }
        }
    }


    d->pal = pal;
    d->pix = pix;
    d->h_total = h;
    return 0;
}


/* Parse XBM-style data: "unsigned char bits[] = { 0x.., ... };" */
static int decode_xbm(decimg_t *d, char *xbmdata)
{
    char *p = strstr(xbmdata, "bits[] = {");
    if (!p) return 1;
    p = strchr(p, '{');
    if (!p) return 1;
    p++;

    size_t npix = (size_t)d->w * d->h;
    unsigned char *pix = malloc(npix);
    if (!pix) return 1;
    unsigned long val = 0;
    int bits_left = 0;
    for (size_t i = 0; i < npix; i++) {
        if (bits_left == 0) {
            val = strtoul(p, &p, 0);
            bits_left = 32;
        }
        bits_left--;
        pix[i] = (val >> bits_left) & 1 ? 0 : TRANSPARENT;
    }

    d->pal = malloc(sizeof(unsigned int));
    if (!d->pal) return 1;
    d->pal[0] = 0xFFFFFF; /* unused; tinted via W_Color */
    d->pix = pix;
    d->color_image = 0;
    return 0;
}

static void finalize_decode(decimg_t *d, W_Image *image)
{
    if (image->frames == 0) {
        if (d->num_views > 0)
            image->frames = d->num_views;
        else if (image->height % image->width == 0)
            image->frames = image->height / image->width;
        else
            image->frames = 1;
    }
    image->height /= image->frames;
    d->h = image->height;
    d->frames = image->frames;
    image->xpm = d->color_image ? 1 : 0;
    image->loaded = 1;
}

/* ---- the W_ API ---------------------------------------------------------- */

void W_Initialize(char *display)
{
    (void)display;
    extern int winwidth, winheight;
    FW = (unsigned int)winwidth;
    FH = (unsigned int)winheight; /* shell window covers the full height */
    fb = malloc(FW * FH * sizeof(*fb));
    fillrgb(0, 0, 0, (int)FW, (int)FH, palette[W_Black]);
    js_canvas_init(FW, FH);
}

W_Window W_MakeWindow(char *name, int x, int y, int width, int height,
                      W_Window parent, char *cursname, int border, W_Color color)
{
    (void)name; (void)parent; (void)cursname; (void)border; (void)color;
    if (nwins >= 8) nwins = 7;
    webwin_t *wn = &wins[nwins];
    wn->x = x;
    wn->y = y;
    wn->w = width;
    wn->h = height;
    wn->idx = nwins;
    wn->buffered = 1;
    nwins++;
    return (W_Window)wn;
}

void W_MapWindow(W_Window window)
{
    /* Queue an expose event for this window, like the X server would. */
    js_push_expose(win_of(window)->idx);
}

void W_UnmapWindow(W_Window window) { (void)window; }
int W_IsMapped(W_Window window) { (void)window; return 1; }

void W_Flush(void) {}
void W_AutoRepeatOn(void) {}
void W_AutoRepeatOff(void) {}
void W_GrabPointer(W_Window window) { (void)window; }
void W_UngrabPointer(void) {}
void W_BlankCursor(W_Window window) { (void)window; }
void W_RevertCursor(W_Window window) { (void)window; }
void W_Beep(void) {}
void W_DestroyWindow(W_Window window) { (void)window; }
void W_ChangeBorder(W_Window window, int color) { (void)window; (void)color; }
void W_TranslatePoints(W_Window window, int *x, int *y) { (void)window; (void)x; (void)y; }
void W_Deiconify(W_Window window) { (void)window; }
void W_Sync(void) {}

int W_WindowWidth(W_Window window) { return win_of(window)->w; }
int W_WindowHeight(W_Window window) { return win_of(window)->h; }
int W_Socket(void) { return 0; }

int W_IsBuffered(W_Window window) { return win_of(window)->buffered; }
void W_Buffer(W_Window window, int on) { win_of(window)->buffered = on; }
void W_DisplayBuffer(W_Window window) { (void)window; upload_frame(); }

void W_ClearArea(W_Window window, int x, int y, unsigned int width, unsigned int height)
{
    webwin_t *win = win_of(window);
    fillpal(win, win->x + x, win->y + y, (int)width, (int)height, backColor);
}

void W_CacheClearArea(W_Window window, int x, int y, int width, int height)
{
    /* The X11 implementation defers clears to a cache to save round trips;
     * with a local framebuffer we can apply them immediately. */
    webwin_t *win = win_of(window);
    fillpal(win, win->x + x, win->y + y, width, height, backColor);
}

void W_FlushClearAreaCache(W_Window window) { (void)window; }

void W_ClearWindow(W_Window window)
{
    webwin_t *win = win_of(window);
    fillpal(win, win->x, win->y, win->w, win->h, backColor);
}

void W_DrawPoint(W_Window window, int x, int y, W_Color color)
{
    webwin_t *win = win_of(window);
    putpx(win, win->x + x, win->y + y, palette[color]);
}

void W_MakeLine(W_Window window, int X0, int Y0, int X1, int Y1, W_Color color)
{ draw_line(win_of(window), X0, Y0, X1, Y1, color); }

void W_MaskText(W_Window window, int x, int y, W_Color color, char *str, int len, W_Font font)
{
    draw_text(win_of(window), x, y, color, str, len, font);
}

void W_WriteText(W_Window window, int x, int y, W_Color color, char *str, int len, W_Font font)
{
    webwin_t *win = win_of(window);
    (void)font;
    /* Like XDrawImageString: the cell background (GC background = black)
     * is filled over the full font row before the glyphs are drawn. */
    fillpal(win, win->x + x, win->y + y, len * W_Textwidth, FONT_ROWS, backColor);
    draw_text(win, x, y, color, str, len, font);
}

int W_StringWidth(char string[], W_Font font)
{
    if (font == W_BigFont) {
        int w = 0;
        for (char *p = string; *p; p++) {
            unsigned char ch = (unsigned char)*p;
            if ((int)ch < 32 || (int)ch >= 127) {
                w += W_Textwidth;
                continue;
            }
            w += bigfont_glyph[ch - 32].adv;
        }
        return w;
    }
    return (int)strlen(string) * W_Textwidth;
}

void W_SetImageDir(char *dir)
{
    (void)dir; /* all images are compiled in */
}

int W_LoadImage(W_Image *image)
{
    if (image->loaded) return 0;
    if (ndecimgs >= 64) return 1;
    decimg_t *d = &decimgs[ndecimgs++];
    memset(d, 0, sizeof(*d));
    d->image = image;
    d->color_image = 1;

    if (image->xpmdata) {
        if (decode_xpm(d, image->xpmdata)) {
            image->bad = 1;
            return 1;
        }
        image->width = d->w;
        image->height = d->h_total;
    } else if (image->xbmdata) {
        d->w = image->width;
        d->h = image->height;
        if (decode_xbm(d, image->xbmdata)) {
            image->bad = 1;
            return 1;
        }
    } else {
        image->bad = 1;
        return 1;
    }

    finalize_decode(d, image);
    return 0;
}

void W_DrawImage(W_Window window, int x, int y, int frame, W_Image *image, W_Color color)
{
    decimg_t *d = dec_of(image);
    if (!d || !d->pix) return;

    int height, f;
    if (frame < 0) {
        height = d->h * d->frames;
        f = 0;
    } else {
        height = d->h;
        f = frame % d->frames;
    }

    webwin_t *win = win_of(window);
    int ax = win->x + x;
    int ay = win->y + y;
    unsigned int tint = palette[color];

    /* Clip to the window rect (the X server clips all draws to the
     * window's drawable) and to the framebuffer. */
    int cx0 = ax < win->x ? win->x : ax;
    int cy0 = ay < win->y ? win->y : ay;
    int cx1 = ax + d->w > win->x + win->w ? win->x + win->w : ax + d->w;
    int cy1 = ay + height > win->y + win->h ? win->y + win->h : ay + height;
    if (cx0 < 0) cx0 = 0;
    if (cy0 < 0) cy0 = 0;
    if (cx1 > (int)FW) cx1 = (int)FW;
    if (cy1 > (int)FH) cy1 = (int)FH;

    for (int py = cy0; py < cy1; py++) {
        int row = py - ay;
        const unsigned char *src = d->pix + ((size_t)f * d->h + row) * d->w;
        for (int px = cx0; px < cx1; px++) {
            int pi = src[px - ax];
            if (pi == TRANSPARENT) continue;
            unsigned int rgb = d->color_image ? d->pal[pi] : tint;
            unsigned int *p = &fb[py * FW + px];
            if (useOR)
                *p = (*p & 0xFF000000u) | rgb;
            else
                *p = 0xFF000000u | rgb;
        }
    }
}

void W_DrawImageNoClip(W_Window window, int x, int y, int frame, W_Image *image, W_Color color)
{
    int saved = useClipMask;
    useClipMask = 0;
    W_DrawImage(window, x, y, frame, image, color);
    useClipMask = saved;
}

/* ---- input events --------------------------------------------------------- */

int W_EventsPending(void)
{
    return js_events_pending();
}

void W_NextEvent(W_Event *event)
{
    long long v = js_event_pop();
    event->type = (int)(v & 0xFF);
    event->key = (int)((v >> 8) & 0x3FF);
    event->x = (int)((v >> 18) & 0x3FF);
    event->y = (int)((v >> 28) & 0x3FF);
    int idx = (int)((v >> 38) & 0xF);
    event->Window = (idx < nwins) ? (W_Window)&wins[idx] : 0;
}

void W_GetMouse(W_Window window, int *x, int *y, int *but)
{
    webwin_t *win = win_of(window);
    long long v = js_get_mouse();
    *x = (int)((v >> 1) & 0x3FF);
    *y = (int)((v >> 17) & 0x3FF) - win->y;
    *but = (v & 1) ? W_LBUTTON : 0;
}

void W_ToggleFullscreen(W_Window win)
{
    (void)win; /* Enter no longer toggles browser fullscreen */
}

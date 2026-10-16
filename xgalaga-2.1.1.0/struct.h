#ifndef STRUCT_H
#define STRUCT_H

#include "Wlib.h"

struct torp {
    struct torp *next, *prev;
    int alive, frame;
    float x, y;
    float xspeed, yspeed;
};

struct star {
    float x, y;
    float speed;
    W_Color color;
};

struct alien {
    float x, y;
    int dir;
    int steer;
    int alive;
    int dying;
    int path, path_pos;
    int escorting;
    int entering, enterdelay;
    W_Image *shape;
};

struct explosion {
    struct explosion *next, *prev;
    float x, y;
    int frame;
    W_Image *shape;
};

struct score_bubble {
    struct score_bubble *next, *prev;
    float x, y;
    int count;
    W_Image *shape;
};

struct js_state {
    signed short but;
    signed long dir;
};

#endif

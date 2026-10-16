/* sound_web.c - Web Audio implementation of the xgalaga sound API.
 *
 * Replaces sound.c for the browser build.  The original implementation
 * forks a separate sound server process that writes raw 8-bit 8000 Hz
 * samples to /dev/dsp; here the same samples are embedded in the binary
 * (sounddata.h, generated from sounds/*.raw) and played through the Web
 * Audio API.  The game only calls init_sound(), play_sound() and
 * kill_sound(); the remaining API is provided for completeness.
 */
#include <config.h>

#ifdef SOUND

#include <emscripten.h>
#include <string.h>

#include "sounddata.h"

extern int playSounds;

static int audioOK = 0;
static int sound_flags[20];

EM_JS(void, js_audio_setdata, (const unsigned int *tbl), {
    const A = globalThis.__xgal.audio;
    const H8 = (typeof HEAPU8 !== "undefined") ? HEAPU8 : Module.HEAPU8;
    const H32 = new Uint32Array(H8.buffer);
    A.data = [];
    for (let i = 0; i < 8; i++) {
        const ptr = H32[tbl / 4 + i * 2];
        const len = H32[tbl / 4 + i * 2 + 1];
        const arr = new Uint8Array(len);
        for (let j = 0; j < len; j++)
            arr[j] = H8[ptr + j];
        A.data.push(arr);
    }
});

EM_JS(void, js_audio_play, (int k), {
    globalThis.__xgal.audio.play(k);
});

EM_JS(void, js_audio_stop, (), {
    globalThis.__xgal.audio.stopAll();
});

void init_sound(void)
{
    int i;

    /* Do not initialize sound if it is not going to be used. */
    if (!playSounds)
        return;

    /* Pass the {ptr, len} pairs of the embedded samples to JS, which
     * decodes them into AudioBuffers on the first user gesture. */
    js_audio_setdata((const unsigned int *)&sounds_web);

    for (i = 0; i < 20; i++)
        sound_flags[i] = 0;
    audioOK = 1;
}

void play_sound(int k)
{
    if (!playSounds || !audioOK)
        return;
    js_audio_play(k);
}

void maybe_play_sound(int k)
{
    if (sound_flags[k] & 1)
        return;
    sound_flags[k] |= 1;
    play_sound(k);
}

void sound_completed(int k)
{
    sound_flags[k] &= ~1;
}

void kill_sound(void)
{
    if (!playSounds || !audioOK)
        return;
    js_audio_stop();
}

#endif /* SOUND */

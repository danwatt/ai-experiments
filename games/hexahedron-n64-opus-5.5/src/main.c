/* Hexahedron 64: bare-metal N64 entry point and frame loop. */
#include "hw.h"
#include "video.h"
#include "pad.h"
#include "textures.h"
#include "audio.h"
#include "game.h"

int main(void)
{
    video_init();
    font_init();
    textures_init();
    dcache_writeback(textures, sizeof textures);
    /* Audio runs from boot (silence until a sound plays): the emulator front end
       paces itself on the audio stream. The page's Start button supplies the
       click browsers require before audio may play. */
    audio_init();
    /* Calibrate the CP0 Count rate against the 60 Hz VI: emulators don't all tick
       Count at the hardware's 46.875 MHz, and game time must follow the display. */
    video_vsync();
    u32 c0 = c0_count();
    for (int i = 0; i < 12; i++) video_vsync();
    float ticks_per_sec = (float)(c0_count() - c0) * (59.94f / 12.0f);
    if (ticks_per_sec < 1e6f) ticks_per_sec = (float)COUNT_HZ;
    u32 last = c0_count();
    for (;;) {
        u32 now = c0_count();
        float dt = (now - last) / ticks_per_sec;
        last = now;
        if (dt > 0.1f) dt = 0.1f;
        if (dt < 0.001f) dt = 0.001f;
        pad_poll();
        game_frame(dt);
        audio_update();
        video_swap();
        audio_update();
    }
}

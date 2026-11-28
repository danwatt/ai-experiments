#include "audio.h"

void game_init(void);
void game_update(u16 buttons);
void game_draw(void);

int main(void)
{
    I_MASK = 0;                             /* everything is polled */
    I_STAT = 0;
    gpu_init();
    pad_init();
    spu_init();
    game_init();
    for (;;) {
        game_update(pad_read());
        spu_update();
        game_draw();                        /* ends with vsync + buffer flip */
    }
}

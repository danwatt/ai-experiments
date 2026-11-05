/* Controller 1 over the PIF (SI DMA, polled). */
#include "hw.h"
#include "pad.h"

static u64 pif_buf[8] __attribute__((aligned(16)));
pad_t pad;

static void si_wait(void) { while (SI_STATUS & 3) {} }

void pad_poll(void)
{
    u8 *b = UNCACHED(pif_buf);
    memset(b, 0, 64);
    b[0] = 0xFF; b[1] = 0x01; b[2] = 0x04; b[3] = 0x01;          /* ch0: tx 1, rx 4, cmd 0x01 */
    b[4] = 0xFF; b[5] = 0xFF; b[6] = 0xFF; b[7] = 0xFF;
    b[8] = 0xFE;                                                 /* end of commands */
    b[63] = 0x01;                                                /* run joybus */
    si_wait();
    SI_DRAM_ADDR = PHYS(pif_buf);
    SI_PIF_AD_WR64B = 0x1FC007C0;
    si_wait();
    SI_STATUS = 0;
    SI_DRAM_ADDR = PHYS(pif_buf);
    SI_PIF_AD_RD64B = 0x1FC007C0;
    si_wait();
    SI_STATUS = 0;
    u16 prev = pad.held;
    if (b[2] & 0xC0) { pad.held = 0; pad.sx = pad.sy = 0; }
    else {
        pad.held = (u16)((b[4] << 8) | b[5]);
        pad.sx = (s8)b[6];
        pad.sy = (s8)b[7];
    }
    pad.pressed = pad.held & ~prev;
}

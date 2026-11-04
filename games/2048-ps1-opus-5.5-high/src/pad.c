/* Digital pad on port 1, polled directly over SIO0 (no BIOS involvement). */
#include "hw.h"

#define CTRL_TX_EN   (1 << 0)
#define CTRL_DTR     (1 << 1)
#define CTRL_RX_EN   (1 << 2)
#define CTRL_ACK     (1 << 4)
#define CTRL_RESET   (1 << 6)
#define CTRL_DSR_IRQ (1 << 12)
#define STAT_TX_RDY  (1 << 0)
#define STAT_RX_RDY  (1 << 1)

static void delay(int n)
{
    volatile int i;
    for (i = 0; i < n; i++) ;
}

void pad_init(void)
{
    SIO_CTRL = CTRL_RESET;
    SIO_MODE = 0x000D;                      /* 8N1, baud factor 1 */
    SIO_BAUD = 0x0088;                      /* ~250 kHz */
    SIO_CTRL = 0;
}

static int wait_ack(void)
{
    int t;
    for (t = 0; t < 3000; t++) {
        if (I_STAT & (1 << IRQ_SIO0)) {
            I_STAT = ~(1u << IRQ_SIO0);
            SIO_CTRL |= CTRL_ACK;
            return 1;
        }
    }
    return 0;
}

static u8 xfer(u8 b)
{
    int t;
    for (t = 0; t < 2000 && !(SIO_STAT & STAT_TX_RDY); t++) ;
    SIO_DATA = b;
    for (t = 0; t < 2000 && !(SIO_STAT & STAT_RX_RDY); t++) ;
    return SIO_DATA;
}

u16 pad_read(void)
{
    u8 r[4] = { 0xFF, 0xFF, 0xFF, 0xFF };
    u8 req[4] = { 0x42, 0x00, 0x00, 0x00 };
    int i;

    I_STAT = ~(1u << IRQ_SIO0);
    SIO_CTRL = CTRL_TX_EN | CTRL_DTR | CTRL_RX_EN | CTRL_ACK | CTRL_DSR_IRQ;
    delay(150);
    while (SIO_STAT & STAT_RX_RDY) (void)SIO_DATA;

    xfer(0x01);                             /* address: controller */
    if (wait_ack()) {
        for (i = 0; i < 4; i++) {
            r[i] = xfer(req[i]);
            if (i < 3 && !wait_ack()) break;
        }
    }
    delay(150);
    SIO_CTRL = 0;

    if (r[1] != 0x5A) return 0;
    return (u16)~(r[2] | (r[3] << 8));
}

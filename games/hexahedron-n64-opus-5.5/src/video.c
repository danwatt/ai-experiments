/* VI setup (320x240, 16-bit, double buffered), vsync, CPU text and rectangles
 * drawn straight into the frame buffer after the RDP finishes. */
#include "hw.h"
#include "video.h"

/* Three frame buffers: the RDP may finish a frame's list a little after the CPU
   submits it, so the VI is always pointed at the buffer submitted one frame
   earlier (one frame of latency, no half-drawn frames). */
u16 *const fb_buf[3] = { (u16 *)0xA0500000, (u16 *)0xA0526000, (u16 *)0xA054C000 };
u16 *const zbuf = (u16 *)0xA0572000;
int fb_back = 1;
static int fb_ready = 0, fb_shown = 0;
u8 font_i4[128 * 32 / 2] __attribute__((aligned(16)));

void video_init(void)
{
    for (int i = 0; i < 3; i++) memset(fb_buf[i], 0, SCR_W * SCR_H * 2);
    VI_ORIGIN = PHYS(fb_buf[0]);
    VI_WIDTH = SCR_W;
    VI_V_INTR = 2;           /* emulators end a frame on the VI interrupt line */
    VI_BURST = 0x03E52239;
    VI_V_SYNC = 0x20D;
    VI_H_SYNC = 0xC15;
    VI_LEAP = 0x0C150C15;
    VI_H_VIDEO = 0x006C02EC;
    VI_V_VIDEO = 0x002501FF;
    VI_V_BURST = 0x000E0204;
    VI_X_SCALE = 0x200;
    VI_Y_SCALE = 0x400;
    VI_CTRL = 0x0000320E;   /* 16 bpp, resample AA, dither filter */
}

/* Wait for the next VI interrupt (raised once per frame at VI_V_INTR, polled in
   MI_INTR with interrupts masked; writing VI_V_CURRENT acknowledges it). */
void video_vsync(void)
{
    VI_V_CURRENT = 0;
    for (int g = 0; g < 20000000; g++)
        if (REG(0xA4300008) & 0x08) break;
    VI_V_CURRENT = 0;
}

void video_swap(void)
{
    video_vsync();
    VI_ORIGIN = PHYS(fb_buf[fb_ready]);
    fb_shown = fb_ready;
    fb_ready = fb_back;
    fb_back = 3 - fb_shown - fb_ready;
}

/* 5x7 font, ASCII 0x20-0x5F, column-major (bit 0 = top row). */
const u8 font5x7[64][5] = {
    {0x00,0x00,0x00,0x00,0x00}, {0x00,0x00,0x5F,0x00,0x00}, {0x00,0x07,0x00,0x07,0x00}, {0x14,0x7F,0x14,0x7F,0x14},
    {0x24,0x2A,0x7F,0x2A,0x12}, {0x23,0x13,0x08,0x64,0x62}, {0x36,0x49,0x55,0x22,0x50}, {0x00,0x05,0x03,0x00,0x00},
    {0x00,0x1C,0x22,0x41,0x00}, {0x00,0x41,0x22,0x1C,0x00}, {0x14,0x08,0x3E,0x08,0x14}, {0x08,0x08,0x3E,0x08,0x08},
    {0x00,0x50,0x30,0x00,0x00}, {0x08,0x08,0x08,0x08,0x08}, {0x00,0x60,0x60,0x00,0x00}, {0x20,0x10,0x08,0x04,0x02},
    {0x3E,0x51,0x49,0x45,0x3E}, {0x00,0x42,0x7F,0x40,0x00}, {0x42,0x61,0x51,0x49,0x46}, {0x21,0x41,0x45,0x4B,0x31},
    {0x18,0x14,0x12,0x7F,0x10}, {0x27,0x45,0x45,0x45,0x39}, {0x3C,0x4A,0x49,0x49,0x30}, {0x01,0x71,0x09,0x05,0x03},
    {0x36,0x49,0x49,0x49,0x36}, {0x06,0x49,0x49,0x29,0x1E}, {0x00,0x36,0x36,0x00,0x00}, {0x00,0x56,0x36,0x00,0x00},
    {0x08,0x14,0x22,0x41,0x00}, {0x14,0x14,0x14,0x14,0x14}, {0x00,0x41,0x22,0x14,0x08}, {0x02,0x01,0x51,0x09,0x06},
    {0x32,0x49,0x79,0x41,0x3E}, {0x7E,0x11,0x11,0x11,0x7E}, {0x7F,0x49,0x49,0x49,0x36}, {0x3E,0x41,0x41,0x41,0x22},
    {0x7F,0x41,0x41,0x22,0x1C}, {0x7F,0x49,0x49,0x49,0x41}, {0x7F,0x09,0x09,0x09,0x01}, {0x3E,0x41,0x49,0x49,0x7A},
    {0x7F,0x08,0x08,0x08,0x7F}, {0x00,0x41,0x7F,0x41,0x00}, {0x20,0x40,0x41,0x3F,0x01}, {0x7F,0x08,0x14,0x22,0x41},
    {0x7F,0x40,0x40,0x40,0x40}, {0x7F,0x02,0x0C,0x02,0x7F}, {0x7F,0x04,0x08,0x10,0x7F}, {0x3E,0x41,0x41,0x41,0x3E},
    {0x7F,0x09,0x09,0x09,0x06}, {0x3E,0x41,0x51,0x21,0x5E}, {0x7F,0x09,0x19,0x29,0x46}, {0x46,0x49,0x49,0x49,0x31},
    {0x01,0x01,0x7F,0x01,0x01}, {0x3F,0x40,0x40,0x40,0x3F}, {0x1F,0x20,0x40,0x20,0x1F}, {0x3F,0x40,0x38,0x40,0x3F},
    {0x63,0x14,0x08,0x14,0x63}, {0x07,0x08,0x70,0x08,0x07}, {0x61,0x51,0x49,0x45,0x43}, {0x00,0x7F,0x41,0x41,0x00},
    {0x02,0x04,0x08,0x10,0x20}, {0x00,0x41,0x41,0x7F,0x00}, {0x04,0x02,0x01,0x02,0x04}, {0x40,0x40,0x40,0x40,0x40},
};

/* 64 glyphs in 8x8 cells, 16 per row, as a 128x32 I4 image for the RDP. */
void font_init(void)
{
    u8 *p = UNCACHED(font_i4);
    memset(p, 0, sizeof font_i4);
    for (int i = 0; i < 64; i++) {
        int ox = (i & 15) * 8, oy = (i >> 4) * 8;
        for (int x = 0; x < 5; x++)
            for (int y = 0; y < 7; y++)
                if (font5x7[i][x] & (1 << y)) {
                    int px = ox + x, py = oy + y, o = (py * 128 + px) >> 1;
                    p[o] |= (px & 1) ? 0x0F : 0xF0;
                }
    }
}

void fill_rect(u16 *fb, int x, int y, int w, int h, u16 c)
{
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    if (x + w > SCR_W) w = SCR_W - x;
    if (y + h > SCR_H) h = SCR_H - y;
    for (int j = 0; j < h; j++) {
        u16 *p = fb + (y + j) * SCR_W + x;
        for (int i = 0; i < w; i++) p[i] = c;
    }
}

/* Darken a rectangle (for text panels). */
void shade_rect(u16 *fb, int x, int y, int w, int h)
{
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    if (x + w > SCR_W) w = SCR_W - x;
    if (y + h > SCR_H) h = SCR_H - y;
    for (int j = 0; j < h; j++) {
        u16 *p = fb + (y + j) * SCR_W + x;
        for (int i = 0; i < w; i++) p[i] = ((p[i] >> 2) & 0x39CE) | 1;
    }
}

static void glyph(u16 *fb, int x, int y, int ch, u16 c, int s)
{
    if (ch >= 'a' && ch <= 'z') ch -= 32;
    if (ch < 32 || ch > 95) ch = '?';
    const u8 *g = font5x7[ch - 32];
    for (int cx = 0; cx < 5; cx++)
        for (int cy = 0; cy < 7; cy++)
            if (g[cx] & (1 << cy)) {
                int px = x + cx * s, py = y + cy * s;
                if (px < 0 || py < 0 || px + s > SCR_W || py + s > SCR_H) continue;
                for (int j = 0; j < s; j++) for (int i = 0; i < s; i++) fb[(py + j) * SCR_W + px + i] = c;
            }
}

int text_width(const char *s, int scale) { return strlen(s) * 6 * scale; }

void draw_text(u16 *fb, int x, int y, const char *s, u16 c, int scale)
{
    for (int i = 0; s[i]; i++) {
        glyph(fb, x + i * 6 * scale + 1, y + 1, s[i], 0x0001, scale);
        glyph(fb, x + i * 6 * scale, y, s[i], c, scale);
    }
}

void draw_text_c(u16 *fb, int y, const char *s, u16 c, int scale)
{
    draw_text(fb, (SCR_W - text_width(s, scale)) / 2, y, s, c, scale);
}

/* Word-wrap s into lines of at most cols characters, centred. Returns lines drawn. */
int draw_wrapped(u16 *fb, int x, int y, int cols, const char *s, u16 c)
{
    char line[64];
    int n = 0, lines = 0;
    while (*s) {
        int len = 0, last = -1;
        while (s[len] && len < cols) { if (s[len] == ' ') last = len; len++; }
        if (s[len] && last > 0) len = last;
        for (n = 0; n < len && n < 63; n++) line[n] = s[n];
        line[n] = 0;
        draw_text(fb, x, y + lines * 10, line, c, 1);
        lines++;
        s += len;
        while (*s == ' ') s++;
    }
    return lines;
}

void fmt_int(char *out, int v)
{
    char tmp[12];
    int n = 0, neg = v < 0;
    if (neg) v = -v;
    do { tmp[n++] = '0' + v % 10; v /= 10; } while (v);
    if (neg) *out++ = '-';
    while (n) *out++ = tmp[--n];
    *out = 0;
}

static void hex32(char *o, u32 v) { for (int i = 0; i < 8; i++) o[i] = "0123456789ABCDEF"[(v >> (28 - 4 * i)) & 15]; o[8] = 0; }

/* Spin on a hardware register: emulators fast-forward a plain branch-to-self
   to the next interrupt, which never comes with interrupts off. */
void halt(void) { for (;;) (void)VI_V_CURRENT; }

void crash(u32 cause, u32 epc, u32 bad)
{
    char b[48];
    u16 *fb = fb_buf[0];
    VI_ORIGIN = PHYS(fb);
    fill_rect(fb, 0, 0, SCR_W, SCR_H, 0x6001);
    draw_text(fb, 20, 30, "HEXAHEDRON 64 CRASHED", 0xFFFF, 2);
    hex32(b, cause); draw_text(fb, 20, 70, "CAUSE", 0xFFFF, 1); draw_text(fb, 90, 70, b, 0xFFFF, 1);
    hex32(b, epc);   draw_text(fb, 20, 82, "EPC", 0xFFFF, 1);   draw_text(fb, 90, 82, b, 0xFFFF, 1);
    hex32(b, bad);   draw_text(fb, 20, 94, "BADVADDR", 0xFFFF, 1); draw_text(fb, 90, 94, b, 0xFFFF, 1);
    halt();
}

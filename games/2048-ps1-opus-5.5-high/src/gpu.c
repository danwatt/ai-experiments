/* GPU: double-buffered 320x240 display, primitives queued in a DMA linked
 * list and sent in one go per frame. Text is drawn from a font atlas kept in
 * VRAM at (640,0) using textured quads, so it can be scaled freely. */
#include "hw.h"

#define SCREEN_W 320
#define SCREEN_H 240
#define FONT_VRAM_X 640
#define FONT_VRAM_Y 0
#define TPAGE_FONT  ((FONT_VRAM_X / 64) | (2 << 7))   /* 15-bit direct, blend 0 */

#define PKT_WORDS 24576

static u32 pkt[PKT_WORDS];
static u32 *pp, *last;
static u32 scratch[16];
static int back;
u32 frame_count;

const u16 *font_atlas(void);

void *memset(void *d, int c, unsigned n)
{
    u8 *p = d;
    while (n--) *p++ = (u8)c;
    return d;
}

void *memcpy(void *d, const void *s, unsigned n)
{
    u8 *p = d;
    const u8 *q = s;
    while (n--) *p++ = *q++;
    return d;
}

static void gp0_wait(void) { while (!(GPUSTAT & (1 << 26))) ; }
static void gp1(u32 cmd) { GP1 = cmd; }

static u32 xy(int x, int y) { return ((u32)(y & 0xFFFF) << 16) | (x & 0xFFFF); }

/* Append an n-word packet to the linked list. */
static u32 *prim(int n)
{
    u32 *h = pp;
    if (pp + n + 1 >= pkt + PKT_WORDS) return scratch;
    *last = (*last & 0xFF000000) | ((u32)h & 0x00FFFFFF);
    *h = ((u32)n << 24) | 0x00FFFFFF;
    last = h;
    pp += n + 1;
    return h + 1;
}

static void upload_font(void)
{
    const u16 *a = font_atlas();
    int i;
    gp0_wait();
    GP0 = 0x01000000;                       /* flush texture cache */
    GP0 = 0xA0000000;                       /* CPU -> VRAM */
    GP0 = xy(FONT_VRAM_X, FONT_VRAM_Y);
    GP0 = (48 << 16) | 128;
    for (i = 0; i < 128 * 48; i += 2)
        GP0 = a[i] | ((u32)a[i + 1] << 16);
    gp0_wait();
}

void gpu_init(void)
{
    gp1(0x00000000);                        /* reset */
    gp1(0x06C60260);                        /* horizontal display range */
    gp1(0x07040010);                        /* vertical range (NTSC, 240 lines) */
    gp1(0x08000001);                        /* 320x240, NTSC, 15-bit, progressive */
    gp1(0x05000000);                        /* display start (0,0) */
    DPCR |= 0x00000800;                     /* enable DMA channel 2 (GPU) */
    gp1(0x04000002);                        /* DMA direction: CPU -> GP0 */

    upload_font();

    /* clear both buffers to black before turning the display on */
    gp0_wait();
    GP0 = 0x02000000; GP0 = xy(0, 0); GP0 = (480 << 16) | 320;
    gp0_wait();
    gp1(0x03000000);                        /* display enable */
    back = 1;
}

void gpu_begin(u32 clear_rgb)
{
    int oy = back ? SCREEN_H : 0;
    u32 *p;
    pp = pkt;
    last = pp;
    *pp++ = 0x00FFFFFF;
    p = prim(6);
    p[0] = 0xE1000600 | TPAGE_FONT;         /* dither, draw to display, font page */
    p[1] = 0xE2000000;                      /* no texture window */
    p[2] = 0xE3000000 | (oy << 10);         /* drawing area top-left */
    p[3] = 0xE4000000 | ((oy + SCREEN_H - 1) << 10) | (SCREEN_W - 1);
    p[4] = 0xE5000000 | (oy << 11);         /* drawing offset */
    p[5] = 0xE6000000;                      /* no mask bit */
    p = prim(3);
    p[0] = 0x02000000 | BGR(clear_rgb);
    p[1] = xy(0, oy);
    p[2] = (SCREEN_H << 16) | SCREEN_W;
}

static void draw_sync(void)
{
    while (D2_CHCR & 0x01000000) ;
    gp0_wait();
}

void vsync(void)
{
    while (!(I_STAT & (1 << IRQ_VBLANK))) ;
    I_STAT = ~(1u << IRQ_VBLANK);
    frame_count++;
}

void gpu_end(void)
{
    gp0_wait();
    D2_MADR = (u32)pkt & 0x00FFFFFF;
    D2_BCR = 0;
    D2_CHCR = 0x01000401;                   /* linked list, from RAM, start */
    draw_sync();
    vsync();
    gp1(0x05000000 | ((back ? SCREEN_H : 0) << 10));
    back ^= 1;
}

void fill_rect(int x, int y, int w, int h, u32 rgb)
{
    u32 *p = prim(3);
    p[0] = 0x02000000 | BGR(rgb);
    p[1] = xy(x, y + (back ? SCREEN_H : 0));
    p[2] = ((u32)h << 16) | w;
}

void rect(int x, int y, int w, int h, u32 rgb, int semi)
{
    u32 *p = prim(3);
    p[0] = ((semi ? 0x62u : 0x60u) << 24) | BGR(rgb);
    p[1] = xy(x, y);
    p[2] = ((u32)h << 16) | w;
}

void tri_f(int x0, int y0, int x1, int y1, int x2, int y2, u32 rgb, int semi)
{
    u32 *p = prim(4);
    p[0] = ((semi ? 0x22u : 0x20u) << 24) | BGR(rgb);
    p[1] = xy(x0, y0);
    p[2] = xy(x1, y1);
    p[3] = xy(x2, y2);
}

/* Gouraud quad: vertices in Z order (TL, TR, BL, BR). */
void quad_g(const s16 *v, const u32 *c, int semi)
{
    u32 *p = prim(8);
    int i;
    for (i = 0; i < 4; i++) {
        p[i * 2] = BGR(c[i]);
        p[i * 2 + 1] = xy(v[i * 2], v[i * 2 + 1]);
    }
    p[0] |= (semi ? 0x3Au : 0x38u) << 24;
}

static u32 mix(u32 a, u32 b)
{
    return (((a & 0xFEFEFE) >> 1) + ((b & 0xFEFEFE) >> 1));
}

/* Flat-topped hexagon of circumradius r, shaded top -> bottom. */
void hex(int cx, int cy, int r, u32 top, u32 bot, int semi)
{
    int hw = r >> 1, h = (r * 222 + 128) >> 8;
    u32 mid = mix(top, bot);
    s16 v[8];
    u32 c[4];

    v[0] = cx - hw; v[1] = cy - h; v[2] = cx + hw; v[3] = cy - h;
    v[4] = cx - r;  v[5] = cy;     v[6] = cx + r;  v[7] = cy;
    c[0] = c[1] = top; c[2] = c[3] = mid;
    quad_g(v, c, semi);

    v[0] = cx - r;  v[1] = cy;     v[2] = cx + r;  v[3] = cy;
    v[4] = cx - hw; v[5] = cy + h; v[6] = cx + hw; v[7] = cy + h;
    c[0] = c[1] = mid; c[2] = c[3] = bot;
    quad_g(v, c, semi);
}

/* Ring between radius r and r - t. */
void hex_outline(int cx, int cy, int r, int t, u32 rgb, int semi)
{
    static const s8 ux[6] = { 2, 1, -1, -2, -1, 1 };   /* vertex dirs * 2 */
    static const s8 uy[6] = { 0, 1, 1, 0, -1, -1 };
    int ri = r - t, i;
    for (i = 0; i < 6; i++) {
        int j = (i + 1) % 6;
        s16 v[8];
        u32 c[4] = { rgb, rgb, rgb, rgb };
        int ho = (r * 222 + 128) >> 8, hi = (ri * 222 + 128) >> 8;
        v[0] = cx + ux[i] * r / 2;  v[1] = cy + uy[i] * ho;
        v[2] = cx + ux[j] * r / 2;  v[3] = cy + uy[j] * ho;
        v[4] = cx + ux[i] * ri / 2; v[5] = cy + uy[i] * hi;
        v[6] = cx + ux[j] * ri / 2; v[7] = cy + uy[j] * hi;
        quad_g(v, c, semi);
    }
}

/* Textured quad from the font atlas, tinted (0x80 = texel colour). */
static void glyph(int x, int y, int w, int h, int u, int v, int tw, int th, u32 rgb)
{
    u32 *p = prim(9);
    u32 c = BGR(rgb);
    c = (c >> 1) & 0x7F7F7F;                /* white texel * c/128 */
    p[0] = 0x2C000000 | c;
    p[1] = xy(x, y);         p[2] = (v << 8) | u;
    p[3] = xy(x + w, y);     p[4] = ((u32)TPAGE_FONT << 16) | (v << 8) | (u + tw);
    p[5] = xy(x, y + h);     p[6] = ((v + th) << 8) | u;
    p[7] = xy(x + w, y + h); p[8] = ((v + th) << 8) | (u + tw);
}

static int glyph_index(char ch)
{
    if (ch >= 'a' && ch <= 'z') ch -= 32;
    if (ch < 0x20 || ch > 0x5F) ch = '?';
    return ch - 0x20;
}

int text_width(const char *s, int sc)
{
    int n = 0;
    while (s[n]) n++;
    return n ? ((n * 6 - 1) * sc) >> 8 : 0;
}

void text(int x, int y, const char *s, int sc, u32 rgb)
{
    int x256 = x << 8;
    for (; *s; s++) {
        int i = glyph_index(*s);
        if (i) {
            int gx = x256 >> 8;
            glyph(gx, y, ((x256 + 5 * sc) >> 8) - gx, (7 * sc) >> 8,
                  (i & 15) * 8, (i >> 4) * 8, 5, 7, rgb);
        }
        x256 += 6 * sc;
    }
}

void text_shadow(int x, int y, const char *s, int sc, u32 rgb)
{
    int d = sc >= 512 ? 2 : 1;
    text(x + d, y + d, s, sc, 0x000000);
    text(x, y, s, sc, rgb);
}

void text_center(int cx, int y, const char *s, int sc, u32 rgb)
{
    text_shadow(cx - text_width(s, sc) / 2, y, s, sc, rgb);
}

int digits_width(const char *s, int sc)
{
    int n = 0;
    while (s[n]) n++;
    return n ? ((n * 9 - 1) * sc) >> 8 : 0;
}

void digits(int x, int y, const char *s, int sc, u32 rgb)
{
    int x256 = x << 8;
    for (; *s; s++) {
        int d = *s - '0';
        int gx = x256 >> 8;
        if (d >= 0 && d <= 9)
            glyph(gx, y, ((x256 + 8 * sc) >> 8) - gx, (10 * sc) >> 8,
                  d * 10, 32, 8, 10, rgb);
        x256 += 9 * sc;
    }
}

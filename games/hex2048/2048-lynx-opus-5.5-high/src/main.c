/*
 * Hex 2048 for the Atari Lynx.
 *
 * 2048 on a 19-cell hexagonal board (radius 2, flat-top hexes), six slide
 * directions. Each frame the CPU builds a chain of Suzy sprite control
 * blocks (1-bit hex masks, 3x5 font glyphs, scaled single pixels for
 * rectangles), Suzy blits them into a 160x102 4bpp back buffer, and Mikey
 * is pointed at the finished buffer.
 *
 * Controls
 *   Up / Down                    slide N / S
 *   Up+Left, Up+Right            slide NW / NE
 *   Down+Left, Down+Right        slide SW / SE
 *   Left / Right alone           slide NW / NE  (hold B for SW / SE)
 *   Option 1                     new game
 *   A                            start / continue / restart
 */

#include <string.h>

#pragma static-locals(on)

#define PEEK(a)    (*(volatile unsigned char *)(a))
#define POKE(a, v) (*(volatile unsigned char *)(a) = (v))
#define POKEW(a, v) (POKE(a, (unsigned int)(v) & 0xFF), POKE((a) + 1, (unsigned int)(v) >> 8))

/* Suzy registers */
#define VIDBAS     0xFC08
#define SCBNEXT    0xFC10
#define SPRGO      0xFC91
#define SPRSYS     0xFC92
#define JOYSTICK   0xFCB0

/* Mikey registers */
#define TIM0CNT    0xFD02
#define TIM2CTLA   0xFD09
#define SDONEACK   0xFD90
#define CPUSLEEP   0xFD91
#define DISPADRL   0xFD94
#define GREEN0     0xFDA0
#define BLUERED0   0xFDB0

#define J_UP    0x80
#define J_DOWN  0x40
#define J_LEFT  0x20
#define J_RIGHT 0x10
#define J_OPT1  0x08
#define J_OPT2  0x04
#define J_B     0x02
#define J_A     0x01
#define J_DIRS  0xF0

#define FB_SIZE 8160

/* Palette slots */
#define C_BG     0
#define C_EMPTY  1
#define C_DARK   2
#define C_LIGHT  3
#define C_TILE0  3      /* tile exponent e uses slot C_TILE0 + e, e = 1..11 */
#define C_SUPER  15

/* 12-bit colours as R, G, B nibbles */
static const unsigned char palette[16][3] = {
    { 0x9, 0x8, 0x7 },  /* background */
    { 0xC, 0xC, 0xB },  /* empty cell */
    { 0x6, 0x5, 0x5 },  /* dark text / panels */
    { 0xF, 0xF, 0xF },  /* light text */
    { 0xE, 0xE, 0xD },  /* 2 */
    { 0xE, 0xD, 0xB },  /* 4 */
    { 0xF, 0xB, 0x7 },  /* 8 */
    { 0xF, 0x9, 0x6 },  /* 16 */
    { 0xF, 0x7, 0x5 },  /* 32 */
    { 0xF, 0x5, 0x3 },  /* 64 */
    { 0xD, 0xB, 0x4 },  /* 128 */
    { 0xD, 0xA, 0x3 },  /* 256 */
    { 0xC, 0x9, 0x2 },  /* 512 */
    { 0xC, 0x8, 0x1 },  /* 1024 */
    { 0xE, 0xA, 0x0 },  /* 2048 */
    { 0x3, 0x3, 0x3 }   /* 4096+ */
};

/* ------------------------------------------------------------------------ */
/* Display buffers and frame timing                                         */

/* Buffer 0 lives in the free RAM above the C stack; buffer 1 is BSS. */
#define FB0 ((unsigned char *)0xC038)
static unsigned char fb1_space[FB_SIZE + 4];

static unsigned char *bufs[2];
static unsigned char back;

/* Maintained by the timer 2 interrupt (vbl.s) once per displayed frame:
   a frame counter, and every joystick bit seen since main last looked. */
extern volatile unsigned char vbl_count;
extern volatile unsigned char joy_latch;
#define frame vbl_count

static void wait_vbl(void)
{
    unsigned char f = vbl_count;

    while (vbl_count == f)
        ;
}

static void show(unsigned char *buf)
{
    POKEW(DISPADRL, buf);
}

/* Show the finished back buffer, then draw into the other one. Mikey picks
   up the new address at the next frame start, so wait for that. */
static void flip(void)
{
    show(bufs[back]);
    wait_vbl();
    back ^= 1;
}

static void init_video(void)
{
    unsigned char i;

    bufs[0] = FB0;
    bufs[1] = (unsigned char *)(((unsigned int)fb1_space + 3) & ~3u);
    memset(bufs[0], 0, FB_SIZE);
    memset(bufs[1], 0, FB_SIZE);
    for (i = 0; i < 16; ++i) {
        POKE(GREEN0 + i, palette[i][1]);
        POKE(BLUERED0 + i, (palette[i][2] << 4) | palette[i][0]);
    }
    POKE(TIM2CTLA, 0x9F);   /* crt0 value $1F plus interrupt enable */
    back = 1;
    show(bufs[0]);
}

/* ------------------------------------------------------------------------ */
/* Sprites                                                                  */

/* SCB layout for a 1bpp sprite that reloads size and its pen palette */
typedef struct scb {
    unsigned char ctl0;
    unsigned char ctl1;
    unsigned char coll;
    struct scb *next;
    const unsigned char *data;
    signed int hpos;
    signed int vpos;
    unsigned int hsize;
    unsigned int vsize;
    unsigned char pens;     /* high nibble: pen 0 colour, low: pen 1 colour */
} scb;

#define BPP_1        0x00
#define TYPE_BACKNC  0x01   /* draws every pixel */
#define TYPE_NONCOLL 0x05   /* pen 0 is transparent */
#define LITERAL      0x80
#define PACKED       0x00
#define REHV         0x10

#define MAX_SCB 200
static scb pool[MAX_SCB];
static unsigned char nscb;
static unsigned char nstatic;           /* SCBs that stay the same between frames */
static unsigned char static_dirty = 1;  /* rebuild them (score changed) */

/* One packed pixel (literal run of 1, then end of line); scaled for rects */
static const unsigned char pixel_data[] = { 3, 0x84, 0x00, 0x00 };

/* Flat-top hex mask, 19x17 px: 3 data bytes per line (literal sprites
   want spare zero bits after the last pixel). */
#define HEX_W 19
#define HEX_H 17
static unsigned char hex_data[HEX_H * 4 + 1];

/* Half widths of the hex for rows dy = 0..8 (apothem 8.5) */
static const unsigned char hexhw[9] = { 9, 9, 8, 8, 7, 6, 6, 5, 5 };

static scb *new_scb(void)
{
    scb *s;

    if (nscb == MAX_SCB)
        return 0;
    s = &pool[nscb];
    if (nscb)
        pool[nscb - 1].next = s;
    ++nscb;
    s->next = 0;
    s->coll = 0;
    return s;
}

static void spr_rect(signed int x, signed int y, unsigned char w, unsigned char h, unsigned char c)
{
    scb *s = new_scb();

    if (!s)
        return;
    s->ctl0 = BPP_1 | TYPE_BACKNC;
    s->ctl1 = PACKED | REHV;
    s->data = pixel_data;
    s->hpos = x;
    s->vpos = y;
    s->hsize = (unsigned int)w << 8;
    s->vsize = (unsigned int)h << 8;
    s->pens = (c << 4) | c;
}

static void spr_bitmap(const unsigned char *data, signed int x, signed int y,
                       unsigned int hsize, unsigned int vsize, unsigned char c)
{
    scb *s = new_scb();

    if (!s)
        return;
    s->ctl0 = BPP_1 | TYPE_NONCOLL;
    s->ctl1 = LITERAL | REHV;
    s->data = data;
    s->hpos = x;
    s->vpos = y;
    s->hsize = hsize;
    s->vsize = vsize;
    s->pens = c;
}

/* Hex centred at (cx, cy); s = 8 is full size, other values scale it. */
static void spr_hex(signed int cx, signed int cy, unsigned char c, unsigned char s)
{
    if (s == 8)
        spr_bitmap(hex_data, cx - 9, cy - 8, 0x100, 0x100, c);
    else
        spr_bitmap(hex_data, cx - ((9 * s) >> 3), cy - s, s << 5, s << 5, c);
}

/* Run the sprite chain into the back buffer and wait for Suzy to finish. */
static void suzy_draw(void)
{
    if (!nscb)
        return;
    pool[nscb - 1].next = 0;
    POKEW(VIDBAS, bufs[back]);
    POKEW(SCBNEXT, &pool[0]);
    POKE(SPRGO, 1);
    POKE(SDONEACK, 0);
    do {
        POKE(CPUSLEEP, 0);
    } while (PEEK(SPRSYS) & 1);
    POKE(SDONEACK, 0);
}

static void init_hex_sprite(void)
{
    unsigned char *p = hex_data;
    unsigned char row, x, hw;
    signed char dy;

    for (row = 0; row < HEX_H; ++row) {
        dy = (signed char)row - 8;
        hw = hexhw[dy < 0 ? -dy : dy];
        *p++ = 4;
        p[0] = p[1] = p[2] = 0;
        for (x = 9 - hw; x <= 9 + hw; ++x)
            p[x >> 3] |= 0x80 >> (x & 7);
        p += 3;
    }
    *p = 0;
}

/* ------------------------------------------------------------------------ */
/* 3x5 font                                                                 */

static const unsigned char font[][5] = {
    {7,5,5,5,7}, {2,6,2,2,7}, {7,1,7,4,7}, {7,1,7,1,7}, {5,5,7,1,1},  /* 0-4 */
    {7,4,7,1,7}, {7,4,7,5,7}, {7,1,1,2,2}, {7,5,7,5,7}, {7,5,7,1,7},  /* 5-9 */
    {2,5,7,5,5}, {6,5,6,5,6}, {3,4,4,4,3}, {6,5,5,5,6}, {7,4,6,4,7},  /* A-E */
    {7,4,6,4,4}, {3,4,5,5,3}, {5,5,7,5,5}, {7,2,2,2,7}, {1,1,1,5,2},  /* F-J */
    {5,5,6,5,5}, {4,4,4,4,7}, {5,7,7,5,5}, {6,5,5,5,5}, {2,5,5,5,2},  /* K-O */
    {6,5,6,4,4}, {2,5,5,6,3}, {6,5,6,5,5}, {3,4,2,1,6}, {7,2,2,2,2},  /* P-T */
    {5,5,5,5,7}, {5,5,5,5,2}, {5,5,7,7,5}, {5,5,2,5,5}, {5,5,2,2,2},  /* U-Y */
    {7,1,2,4,7},                                                      /* Z */
    {0,0,7,0,0}, {0,2,0,2,0}, {2,2,2,0,2}, {0,0,0,0,2}, {1,1,2,4,4},  /* - : ! . / */
    {0,2,7,2,0}                                                       /* + */
};
#define NGLYPH (sizeof(font) / 5)

/* Glyph sprites: 5 lines of { offset 2, bits }, then end of sprite */
static unsigned char glyph_data[NGLYPH][11];

static void init_font_sprites(void)
{
    unsigned char g, row;

    for (g = 0; g < NGLYPH; ++g) {
        for (row = 0; row < 5; ++row) {
            glyph_data[g][row * 2] = 2;
            glyph_data[g][row * 2 + 1] = font[g][row] << 5;
        }
        glyph_data[g][10] = 0;
    }
}

#define NONE_GLYPH 0xFF

static unsigned char glyph(char ch)
{
    if (ch >= '0' && ch <= '9') return ch - '0';
    if (ch >= 'A' && ch <= 'Z') return ch - 'A' + 10;
    switch (ch) {
    case '-': return 36;
    case ':': return 37;
    case '!': return 38;
    case '.': return 39;
    case '/': return 40;
    case '+': return 41;
    }
    return NONE_GLYPH;
}

/* Text with each font pixel scaled to sx by sy; gap = pixels between chars */
static void spr_text(signed int x, signed int y, const char *s,
                     unsigned char c, unsigned char sx, unsigned char sy, unsigned char gap)
{
    unsigned char g, adv = 3 * sx + gap;

    for (; *s; ++s, x += adv) {
        g = glyph(*s);
        if (g != NONE_GLYPH)
            spr_bitmap(glyph_data[g], x, y, sx << 8, sy << 8, c);
    }
}

static void spr_text_centered(signed int cx, signed int y, const char *s,
                              unsigned char c, unsigned char sx, unsigned char sy, unsigned char gap)
{
    unsigned char n = strlen(s);
    unsigned char w = n ? n * (3 * sx + gap) - gap : 0;

    spr_text(cx - (w >> 1), y, s, c, sx, sy, gap);
}

/* ------------------------------------------------------------------------ */
/* Board geometry                                                           */

#define NCELL  19
#define NONE   0xFF
#define BX     50   /* board centre */
#define BY     51

static signed char cq[NCELL], cr[NCELL];
static unsigned char cellx[NCELL], celly[NCELL];
static unsigned char cellat[5][5];

/* Directions: 0 N, 1 NE, 2 SE, 3 S, 4 SW, 5 NW (axial q, r) */
static const signed char dirq[6] = { 0, 1, 1, 0, -1, -1 };
static const signed char dirr[6] = { -1, -1, 0, 1, 1, 0 };

/* lines[d][k] lists one row of cells, front (the side tiles slide to) first */
static unsigned char lines[6][5][5];
static unsigned char linelen[6][5];

static unsigned char neighbour(unsigned char c, unsigned char d)
{
    signed char q = cq[c] + dirq[d];
    signed char r = cr[c] + dirr[d];

    if (q < -2 || q > 2 || r < -2 || r > 2)
        return NONE;
    return cellat[q + 2][r + 2];
}

static void init_board_geometry(void)
{
    signed char q, r;
    unsigned char n = 0, d, k, c, x, len;

    memset(cellat, NONE, sizeof(cellat));
    for (q = -2; q <= 2; ++q) {
        for (r = -2; r <= 2; ++r) {
            if (q + r < -2 || q + r > 2)
                continue;
            cq[n] = q;
            cr[n] = r;
            cellx[n] = BX + 16 * q;
            celly[n] = BY + 18 * r + 9 * q;
            cellat[q + 2][r + 2] = n;
            ++n;
        }
    }
    for (d = 0; d < 6; ++d) {
        k = 0;
        for (c = 0; c < NCELL; ++c) {
            if (neighbour(c, d) != NONE)
                continue;
            len = 0;
            for (x = c; x != NONE; x = neighbour(x, (d + 3) % 6))
                lines[d][k][len++] = x;
            linelen[d][k++] = len;
        }
    }
}

/* ------------------------------------------------------------------------ */
/* Game state                                                               */

static unsigned char board[NCELL];       /* tile exponents, 0 = empty */
static unsigned long score, best;
static unsigned char won;                /* 2048 reached and acknowledged */
static unsigned int rng;

static char labels[18][6];               /* tile text by exponent */
static char score_str[12], best_str[12];

/* Tiles to draw this frame */
static unsigned char tn;
static unsigned char tx[NCELL], ty[NCELL], te[NCELL], ts[NCELL];

/* Last move, for animation */
static unsigned char an;
static unsigned char asrc[NCELL], adst[NCELL], ae[NCELL];
static unsigned char merged[NCELL];
static unsigned char spawned;

static unsigned char random8(void)
{
    /* 16-bit xorshift */
    rng ^= rng << 7;
    rng ^= rng >> 9;
    rng ^= rng << 8;
    return (unsigned char)rng;
}

static void fmt_ulong(char *out, unsigned long v)
{
    char tmp[11];
    unsigned char n = 0;

    do {
        tmp[n++] = '0' + (unsigned char)(v % 10);
        v /= 10;
    } while (v);
    while (n)
        *out++ = tmp[--n];
    *out = 0;
}

static void init_labels(void)
{
    unsigned char e;
    unsigned long v;

    for (e = 1; e < 18; ++e) {
        v = 1UL << e;
        if (v >= 10000) {
            fmt_ulong(labels[e], v >> 10);
            strcat(labels[e], "K");
        } else {
            fmt_ulong(labels[e], v);
        }
    }
}

static void update_score_strings(void)
{
    if (score > best)
        best = score;
    fmt_ulong(score_str, score);
    fmt_ulong(best_str, best);
    static_dirty = 1;
}

static unsigned char spawn_tile(void)
{
    unsigned char empty[NCELL];
    unsigned char n = 0, c;

    for (c = 0; c < NCELL; ++c)
        if (!board[c])
            empty[n++] = c;
    if (!n)
        return NONE;
    c = empty[random8() % n];
    board[c] = (random8() < 26) ? 2 : 1;   /* ~10% fours */
    return c;
}

static unsigned char can_move(void)
{
    unsigned char c, d, n;

    for (c = 0; c < NCELL; ++c) {
        if (!board[c])
            return 1;
        for (d = 0; d < 3; ++d) {
            n = neighbour(c, d);
            if (n != NONE && board[n] == board[c])
                return 1;
        }
    }
    return 0;
}

static unsigned char max_tile(void)
{
    unsigned char c, m = 0;

    for (c = 0; c < NCELL; ++c)
        if (board[c] > m)
            m = board[c];
    return m;
}

/* Slide toward direction d. Fills the animation records; returns 1 if anything moved. */
static unsigned char do_move(unsigned char d)
{
    static unsigned char nb[NCELL];
    unsigned char k, i, n, w, c, v, dst, moved = 0, lastmerged;
    const unsigned char *line;

    memset(nb, 0, sizeof(nb));
    memset(merged, 0, sizeof(merged));
    an = 0;
    for (k = 0; k < 5; ++k) {
        line = lines[d][k];
        n = linelen[d][k];
        w = 0;
        lastmerged = 1;
        for (i = 0; i < n; ++i) {
            c = line[i];
            v = board[c];
            if (!v)
                continue;
            if (w && !lastmerged && nb[line[w - 1]] == v) {
                dst = line[w - 1];
                nb[dst] = v + 1;
                merged[dst] = 1;
                lastmerged = 1;
                score += 1UL << (v + 1);
            } else {
                dst = line[w++];
                nb[dst] = v;
                lastmerged = 0;
            }
            asrc[an] = c;
            adst[an] = dst;
            ae[an++] = v;
            if (c != dst)
                moved = 1;
        }
    }
    if (moved)
        memcpy(board, nb, sizeof(board));
    return moved;
}

static void new_game(void)
{
    memset(board, 0, sizeof(board));
    score = 0;
    won = 0;
    spawn_tile();
    spawn_tile();
    update_score_strings();
}

/* ------------------------------------------------------------------------ */
/* Rendering                                                                */

#define OV_NONE   0
#define OV_TITLE  1
#define OV_OVER   2
#define OV_WIN    3

static void add_tile(unsigned char x, unsigned char y, unsigned char e, unsigned char s)
{
    tx[tn] = x;
    ty[tn] = y;
    te[tn] = e;
    ts[tn++] = s;
}

static void board_tiles(void)
{
    unsigned char c;

    tn = 0;
    for (c = 0; c < NCELL; ++c)
        if (board[c])
            add_tile(cellx[c], celly[c], board[c], 8);
}

static void spr_tile(unsigned char x, unsigned char y, unsigned char e, unsigned char s)
{
    const char *lab = labels[e];
    unsigned char tc = e <= 2 ? C_DARK : C_LIGHT;

    spr_hex(x, y, e <= 11 ? C_TILE0 + e : C_SUPER, s);
    if (s < 7)
        return;
    if (strlen(lab) <= 2)
        spr_text_centered(x, y - 5, lab, tc, 2, 2, 1);
    else
        spr_text_centered(x, y - 2, lab, tc, 1, 1, 1);
}

static void spr_panel(unsigned char y, const char *title, const char *value)
{
    spr_rect(100, y, 58, 22, C_DARK);
    spr_text_centered(129, y + 3, title, C_EMPTY, 1, 1, 1);
    if (strlen(value) <= 7)
        spr_text_centered(129, y + 10, value, C_LIGHT, 2, 2, 2);
    else
        spr_text_centered(129, y + 12, value, C_LIGHT, 1, 1, 1);
}

static void spr_band(const char *big, const char *small)
{
    spr_rect(0, 40, 100, 23, C_DARK);
    spr_text_centered(BX, 43, big, C_LIGHT, 2, 2, 2);
    spr_text_centered(BX, 55, small, C_EMPTY, 1, 1, 1);
}

#ifdef DEBUG
static unsigned char render_frames;
#endif

static void render(unsigned char overlay)
{
    unsigned char i;
#ifdef DEBUG
    unsigned char f0 = frame;
#endif

    if (static_dirty) {
        /* Background, HUD and empty cells */
        nscb = 0;
        spr_rect(0, 0, 160, 102, C_BG);
        spr_text_centered(129, 4, "HEX", C_LIGHT, 2, 2, 2);
        spr_text_centered(129, 16, "2048", C_TILE0 + 11, 2, 2, 2);
        spr_panel(31, "SCORE", score_str);
        spr_panel(57, "BEST", best_str);
        spr_text_centered(129, 82, "OPT1:NEW", C_EMPTY, 1, 1, 1);
        spr_text_centered(129, 89, "L/R:NW/NE", C_EMPTY, 1, 1, 1);
        spr_text_centered(129, 96, "B+L/R:SW/SE", C_EMPTY, 1, 1, 1);
        for (i = 0; i < NCELL; ++i)
            spr_hex(cellx[i], celly[i], C_EMPTY, 8);
        nstatic = nscb;
        static_dirty = 0;
    }
    nscb = nstatic;

    for (i = 0; i < tn; ++i)
        spr_tile(tx[i], ty[i], te[i], ts[i]);

    switch (overlay) {
    case OV_TITLE: spr_band("HEX 2048", "PRESS A TO START"); break;
    case OV_OVER:  spr_band("GAME OVER", "PRESS A TO RETRY"); break;
    case OV_WIN:   spr_band("YOU WIN!", "PRESS A TO GO ON"); break;
    }
#ifdef DEBUG
    {
        static char dbg[4];
        static const char hx[] = "0123456789ABCDEF";
        dbg[0] = hx[render_frames >> 4];
        dbg[1] = hx[render_frames & 15];
        dbg[2] = 0;
        spr_rect(0, 90, 16, 12, C_DARK);
        spr_text(1, 91, dbg, C_LIGHT, 2, 2, 1);
    }
#endif
    suzy_draw();
    flip();
#ifdef DEBUG
    render_frames = frame - f0;
#endif
}

#define SLIDE_SHIFT  2
#define SLIDE_FRAMES (1 << SLIDE_SHIFT)

static void animate_move(void)
{
    static signed int ax[NCELL], ay[NCELL];
    static signed char dx[NCELL], dy[NCELL];
    unsigned char f, i;

    for (i = 0; i < an; ++i) {
        dx[i] = cellx[adst[i]] - cellx[asrc[i]];
        dy[i] = celly[adst[i]] - celly[asrc[i]];
        ax[i] = ay[i] = 0;
    }
    for (f = 1; f <= SLIDE_FRAMES; ++f) {
        tn = 0;
        for (i = 0; i < an; ++i) {
            ax[i] += dx[i];
            ay[i] += dy[i];
            add_tile(cellx[asrc[i]] + (ax[i] >> SLIDE_SHIFT),
                     celly[asrc[i]] + (ay[i] >> SLIDE_SHIFT), ae[i], 8);
        }
        render(OV_NONE);
    }
}

/* Merged tiles bulge and the new tile grows in. */
#define POP_FRAMES 3

static void animate_pop(void)
{
    static const unsigned char grow[POP_FRAMES] = { 3, 5, 7 };
    static const unsigned char bulge[POP_FRAMES] = { 10, 10, 9 };
    unsigned char f, c;

    for (f = 0; f < POP_FRAMES; ++f) {
        tn = 0;
        for (c = 0; c < NCELL; ++c) {
            if (!board[c])
                continue;
            if (c == spawned)
                add_tile(cellx[c], celly[c], board[c], grow[f]);
            else if (merged[c])
                add_tile(cellx[c], celly[c], board[c], bulge[f]);
            else
                add_tile(cellx[c], celly[c], board[c], 8);
        }
        render(OV_NONE);
    }
}

/* ------------------------------------------------------------------------ */
/* Input                                                                    */

#define SETTLE 4    /* frames to collect a D-pad combo before acting */

static unsigned char joy_prev;
static unsigned char dir_acc, dir_count, dir_lock;

static unsigned char decode_dir(unsigned char acc)
{
    unsigned char u = acc & J_UP, dn = acc & J_DOWN;
    unsigned char l = acc & J_LEFT, r = acc & J_RIGHT;

    if ((u && dn) || (l && r && !u && !dn))
        return NONE;
    if (u)
        return l ? 5 : r ? 1 : 0;
    if (dn)
        return l ? 4 : r ? 2 : 3;
    if (acc & J_B)
        return l ? 4 : 2;
    return l ? 5 : 1;
}

/* Call once per frame. Collects D-pad bits for SETTLE frames (or until
   release, for quick taps) so diagonals can be pressed one key at a time.
   Returns a direction 0..5, or NONE. */
static unsigned char poll_dir(unsigned char j)
{
    unsigned char acc;

    if (!(j & J_DIRS)) {
        acc = dir_lock ? 0 : dir_acc;
        dir_lock = 0;
        dir_acc = 0;
        dir_count = 0;
        return acc ? decode_dir(acc) : NONE;
    }
    if (dir_lock)
        return NONE;
    dir_acc |= j;
    if (++dir_count < SETTLE)
        return NONE;
    dir_lock = 1;
    return decode_dir(dir_acc);
}

/* Wait for the next frame and return newly pressed buttons. */
static unsigned char next_frame(unsigned char *joy)
{
    unsigned char j, pressed;

    wait_vbl();
    /* Include presses that came and went while we were busy animating */
    __asm__("sei");
    j = joy_latch | PEEK(JOYSTICK);
    joy_latch = 0;
    __asm__("cli");
    pressed = j & ~joy_prev;
    joy_prev = j;
    *joy = j;
    return pressed;
}

static void wait_for_a(void)
{
    unsigned char j;

    while (!(next_frame(&j) & J_A))
        ;
}

/* ------------------------------------------------------------------------ */

void main(void)
{
    unsigned char j, pressed, d;

    init_video();
    init_hex_sprite();
    init_font_sprites();
    init_board_geometry();
    init_labels();
    update_score_strings();

    /* Title: empty board; time spent here seeds the RNG. */
    tn = 0;
    render(OV_TITLE);
    rng = 1;
    do {
        pressed = next_frame(&j);
        rng += frame + PEEK(TIM0CNT);
    } while (!(pressed & J_A));
    if (!rng)
        rng = 0xACE1;

    new_game();
    for (;;) {
        board_tiles();
        render(OV_NONE);

        for (;;) {
            pressed = next_frame(&j);
            if (pressed & J_OPT1) {
                new_game();
                break;
            }
            d = poll_dir(j);
            if (d == NONE || !do_move(d))
                continue;

            animate_move();
            spawned = spawn_tile();
            update_score_strings();
            animate_pop();

            if (!won && max_tile() >= 11) {
                won = 1;
                board_tiles();
                render(OV_WIN);
                wait_for_a();
            } else if (!can_move()) {
                board_tiles();
                render(OV_OVER);
                wait_for_a();
                new_game();
            }
            break;
        }
    }
}

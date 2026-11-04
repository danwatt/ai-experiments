/* Hex 2048: 19-cell hexagonal board (radius 2), flat-topped hexes, six
 * slide directions. Axial coordinates (q, r); a tile slides along a
 * direction until it hits the edge or another tile, merging once with an
 * equal neighbour per move. */
#include "hw.h"

void spu_play(int note, int frames, int vol, int delay);

#define NCELLS  19
#define CELL    24          /* layout circumradius */
#define TILE_R  21
#define BX      106
#define BY      121
#define SLIDE_T 6
#define POP_T   8

enum { DIR_N, DIR_NE, DIR_SE, DIR_S, DIR_SW, DIR_NW, DIR_NONE };
enum { ST_TITLE, ST_PLAY, ST_PAUSE, ST_OVER, ST_WIN };

static const s8 dq[6] = { 0, 1, 1, 0, -1, -1 };
static const s8 dr[6] = { -1, -1, 0, 1, 1, 0 };

static s8 cq[NCELLS], cr[NCELLS];
static s16 cx[NCELLS], cy[NCELLS];
static s8 cell_at[5][5];
static u8 order[6][NCELLS];

static u8 grid[NCELLS];                     /* tile exponent, 0 = empty */
static u8 undo_grid[NCELLS];
static u32 undo_score;
static int can_undo;
static u32 score, best;
static int won, pending_win, pending_over;
static int state, menu_sel;

static struct { u8 from, to, v; } anim[NCELLS];
static int nanim;
static u8 fx[NCELLS];                       /* 1 = merged (pop), 2 = spawned (grow) */
static int anim_t = -1;

static u32 popup_val;
static int popup_t;

static u32 rng = 0x2545F491;
static u16 prev_btn;
static int chord_t = -1, chord_lock;
static u16 chord_acc;

/* ---------------------------------------------------------------- utils */

static u32 rand32(void)
{
    rng ^= rng << 13;
    rng ^= rng >> 17;
    rng ^= rng << 5;
    return rng;
}

static void utoa(u32 v, char *buf)
{
    char tmp[12];
    int n = 0;
    do { tmp[n++] = '0' + v % 10; v /= 10; } while (v);
    while (n) *buf++ = tmp[--n];
    *buf = 0;
}

static int at(int q, int r)
{
    if (q < -2 || q > 2 || r < -2 || r > 2) return -1;
    return cell_at[q + 2][r + 2];
}

static u32 scale_rgb(u32 c, int k)          /* k/256, clamped */
{
    u32 r = ((c >> 16) & 0xFF) * k >> 8, g = ((c >> 8) & 0xFF) * k >> 8, b = (c & 0xFF) * k >> 8;
    if (r > 255) r = 255;
    if (g > 255) g = 255;
    if (b > 255) b = 255;
    return (r << 16) | (g << 8) | b;
}

static u32 tint(u32 c, int k)               /* blend toward white by k/256 */
{
    u32 r = (c >> 16) & 0xFF, g = (c >> 8) & 0xFF, b = c & 0xFF;
    r += (255 - r) * k >> 8; g += (255 - g) * k >> 8; b += (255 - b) * k >> 8;
    return (r << 16) | (g << 8) | b;
}

/* gentle wobble: 32-entry sine, amplitude 64 */
static const s8 wave[32] = {
    0, 12, 24, 35, 45, 53, 59, 63, 64, 63, 59, 53, 45, 35, 24, 12,
    0, -12, -24, -35, -45, -53, -59, -63, -64, -63, -59, -53, -45, -35, -24, -12,
};

/* ----------------------------------------------------------------- logic */

static void init_cells(void)
{
    int q, r, n = 0, d, i, j;
    for (q = -2; q <= 2; q++)
        for (r = -2; r <= 2; r++) {
            int s = -q - r;
            if (s < -2 || s > 2) { cell_at[q + 2][r + 2] = -1; continue; }
            cq[n] = q; cr[n] = r;
            cell_at[q + 2][r + 2] = n;
            cx[n] = BX + q * 36;                            /* 1.5 * CELL */
            j = (2 * r + q) * 2078;                         /* sqrt(3)/2 * CELL * 100 */
            cy[n] = BY + (j >= 0 ? j + 50 : j - 50) / 100;
            n++;
        }
    /* per direction, cells sorted furthest-along-direction first */
    for (d = 0; d < 6; d++) {
        int key[NCELLS];
        for (i = 0; i < NCELLS; i++) {
            int s = -cq[i] - cr[i], ds = -dq[d] - dr[d];
            key[i] = cq[i] * dq[d] + cr[i] * dr[d] + s * ds;
            order[d][i] = i;
        }
        for (i = 1; i < NCELLS; i++)
            for (j = i; j > 0 && key[order[d][j]] > key[order[d][j - 1]]; j--) {
                u8 t = order[d][j]; order[d][j] = order[d][j - 1]; order[d][j - 1] = t;
            }
    }
}

static int spawn(void)
{
    int empty[NCELLS], n = 0, i, c;
    for (i = 0; i < NCELLS; i++)
        if (!grid[i]) empty[n++] = i;
    if (!n) return -1;
    c = empty[rand32() % n];
    grid[c] = (rand32() % 10) ? 1 : 2;
    fx[c] = 2;
    return c;
}

static int can_move(void)
{
    int i, d;
    for (i = 0; i < NCELLS; i++) {
        if (!grid[i]) return 1;
        for (d = 0; d < 3; d++) {
            int n = at(cq[i] + dq[d], cr[i] + dr[d]);
            if (n >= 0 && grid[n] == grid[i]) return 1;
        }
    }
    return 0;
}

static void new_game(void)
{
    memset(grid, 0, sizeof(grid));
    memset(fx, 0, sizeof(fx));
    score = 0;
    won = pending_win = pending_over = 0;
    can_undo = 0;
    popup_t = 0;
    spawn();
    spawn();
    nanim = 0;
    anim_t = SLIDE_T;                       /* skip slide, play the grow */
    state = ST_PLAY;
    spu_play(67, 6, 0x1400, 0);
    spu_play(72, 6, 0x1400, 5);
    spu_play(79, 10, 0x1400, 10);
}

static const u8 merge_note[] = { 0, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96, 98 };

static int do_move(int d)
{
    u8 ng[NCELLS], merged[NCELLS];
    int k, moved = 0, top = 0;
    u32 gained = 0;

    memcpy(ng, grid, NCELLS);
    memset(merged, 0, NCELLS);
    nanim = 0;
    for (k = 0; k < NCELLS; k++) {
        int i = order[d][k], v = ng[i], cur = i, m = 0;
        if (!v) continue;
        for (;;) {
            int n = at(cq[cur] + dq[d], cr[cur] + dr[d]);
            if (n < 0) break;
            if (!ng[n]) { cur = n; continue; }
            if (ng[n] == v && !merged[n]) { cur = n; m = 1; }
            break;
        }
        anim[nanim].from = i; anim[nanim].to = cur; anim[nanim].v = v; nanim++;
        if (cur != i) {
            moved = 1;
            ng[i] = 0;
            if (m) {
                ng[cur] = v + 1;
                merged[cur] = 1;
                gained += 1u << (v + 1);
                if (v + 1 > top) top = v + 1;
            } else {
                ng[cur] = v;
            }
        }
    }
    if (!moved) return 0;

    memcpy(undo_grid, grid, NCELLS);
    undo_score = score;
    can_undo = 1;
    memcpy(grid, ng, NCELLS);
    score += gained;
    if (score > best) best = score;
    for (k = 0; k < NCELLS; k++) fx[k] = merged[k];
    spawn();
    anim_t = 0;

    if (gained) { popup_val = gained; popup_t = 40; }
    if (top) spu_play(merge_note[top < 17 ? top : 17], 10, 0x1C00, SLIDE_T - 2);
    else spu_play(43, 3, 0x0A00, 0);
    if (top >= 11 && !won) { won = 1; pending_win = 1; }
    if (!can_move()) pending_over = 1;
    return 1;
}

static void finish_anim(void)
{
    anim_t = -1;
    if (pending_win) {
        pending_win = 0;
        state = ST_WIN;
        spu_play(72, 8, 0x1C00, 1);
        spu_play(76, 8, 0x1C00, 8);
        spu_play(79, 8, 0x1C00, 15);
        spu_play(84, 20, 0x1C00, 22);
    } else if (pending_over) {
        pending_over = 0;
        state = ST_OVER;
        spu_play(67, 10, 0x1800, 1);
        spu_play(63, 10, 0x1800, 12);
        spu_play(60, 24, 0x1800, 23);
    }
}

/* D-pad chords: up/down alone go N/S, combined with left/right they go to
 * the diagonals. A short window lets the second key of a chord arrive. */
static int dpad_dir(u16 btn)
{
    u16 dpad = btn & (PAD_UP | PAD_DOWN | PAD_LEFT | PAD_RIGHT);
    u16 v, h;
    int resolve = 0;

    if (chord_lock) {
        if (!dpad) chord_lock = 0;
        return DIR_NONE;
    }
    if (dpad) {
        if (chord_t < 0) { chord_t = 0; chord_acc = 0; }
        chord_acc |= dpad;
        chord_t++;
        v = chord_acc & (PAD_UP | PAD_DOWN);
        h = chord_acc & (PAD_LEFT | PAD_RIGHT);
        if ((v && h) || chord_t > 5) { resolve = 1; chord_lock = 1; }
    } else if (chord_t >= 0) {
        resolve = 1;
    }
    if (!resolve) return DIR_NONE;
    chord_t = -1;
    v = chord_acc & (PAD_UP | PAD_DOWN);
    h = chord_acc & (PAD_LEFT | PAD_RIGHT);
    if (v == PAD_UP) return h == PAD_LEFT ? DIR_NW : h == PAD_RIGHT ? DIR_NE : DIR_N;
    if (v == PAD_DOWN) return h == PAD_LEFT ? DIR_SW : h == PAD_RIGHT ? DIR_SE : DIR_S;
    return DIR_NONE;
}

void game_init(void)
{
    init_cells();
    state = ST_TITLE;
}

void game_update(u16 btn)
{
    u16 press = btn & ~prev_btn;
    int dir = DIR_NONE;
    prev_btn = btn;
    rng += frame_count;                     /* stir with timing of play */
    if (!rng) rng = 1;

    if (anim_t >= 0 && ++anim_t >= SLIDE_T + POP_T) finish_anim();
    if (popup_t) popup_t--;

    switch (state) {
    case ST_TITLE:
        if (press & (PAD_START | PAD_CROSS)) new_game();
        break;

    case ST_PLAY:
        dir = dpad_dir(btn);
        if (press & PAD_TRIANGLE) dir = DIR_N;
        if (press & PAD_CROSS)    dir = DIR_S;
        if (press & PAD_L1)       dir = DIR_NW;
        if (press & PAD_R1)       dir = DIR_NE;
        if (press & PAD_L2)       dir = DIR_SW;
        if (press & PAD_R2)       dir = DIR_SE;
        if (dir != DIR_NONE) {
            if (anim_t >= 0) finish_anim();
            if (state == ST_PLAY) do_move(dir);
        } else if ((press & PAD_SELECT) && can_undo) {
            memcpy(grid, undo_grid, NCELLS);
            score = undo_score;
            can_undo = 0;
            pending_over = pending_win = 0;
            anim_t = -1;
            spu_play(55, 6, 0x1000, 0);
        } else if (press & PAD_START) {
            state = ST_PAUSE;
            menu_sel = 0;
        }
        break;

    case ST_PAUSE:
        if (press & (PAD_UP | PAD_DOWN)) { menu_sel ^= 1; spu_play(60, 3, 0x0C00, 0); }
        if (press & (PAD_START | PAD_CROSS | PAD_CIRCLE)) {
            if (menu_sel) new_game(); else state = ST_PLAY;
        }
        break;

    case ST_WIN:
        if (press & (PAD_START | PAD_CROSS)) {
            state = ST_PLAY;
            if (!can_move()) state = ST_OVER;
        }
        break;

    case ST_OVER:
        if ((press & PAD_SELECT) && can_undo) {
            memcpy(grid, undo_grid, NCELLS);
            score = undo_score;
            can_undo = 0;
            state = ST_PLAY;
        } else if (press & PAD_START) {
            new_game();
        }
        break;
    }
}

/* ------------------------------------------------------------- drawing */

static const u32 tile_rgb[] = {
    0xCDC1B4, 0xEEE4DA, 0xEDE0C8, 0xF2B179, 0xF59563, 0xF67C5F, 0xF65E3B,
    0xEDCF72, 0xEDCC61, 0xEDC850, 0xEDC53F, 0xEDC22E, 0x8E6CC8, 0x6C4FB0,
    0x4C3A96, 0x3C3A32, 0x2D2B26,
};

static void draw_tile(int x, int y, int e, int s)
{
    int r = TILE_R * s >> 8, nd, sc;
    u32 col = tile_rgb[e < 16 ? e : 16], txt;
    char buf[12];

    if (r < 3) return;
    hex(x + 1, y + 3, r, 0x000000, 0x000000, 1);
    hex(x, y, r, scale_rgb(col, 170), scale_rgb(col, 150), 0);
    hex(x, y, r - 2, tint(col, 70), scale_rgb(col, 236), 0);

    utoa(1u << e, buf);
    for (nd = 0; buf[nd]; nd++) ;
    txt = e <= 2 ? 0x776E65 : 0xF9F6F2;
    if (nd <= 4) {
        static const s16 scales[5] = { 0, 512, 384, 256, 224 };
        int w, h;
        sc = scales[nd] * s >> 8;
        w = digits_width(buf, sc);
        h = 10 * sc >> 8;
        digits(x - w / 2, y - h / 2, buf, sc, txt);
    } else {
        int w, h;
        sc = s;
        w = text_width(buf, sc);
        h = 7 * sc >> 8;
        text(x - w / 2, y - h / 2, buf, sc, txt);
    }
}

static void draw_background(void)
{
    static const s16 bx[8] = { 20, 90, 170, 250, 300, 130, 60, 220 };
    static const u8 br[8] = { 30, 18, 40, 24, 34, 14, 22, 28 };
    static const u8 sp[8] = { 3, 5, 2, 4, 3, 6, 4, 2 };
    s16 v[8] = { 0, 0, 320, 0, 0, 240, 320, 240 };
    u32 c[4] = { 0x23284A, 0x2A2448, 0x0E1022, 0x100C1E };
    int i;
    quad_g(v, c, 0);
    for (i = 0; i < 8; i++) {
        int span = 240 + 2 * br[i];
        int y = 240 + br[i] - (int)((frame_count * sp[i] / 8 + i * 97) % span);
        int x = bx[i] + wave[(frame_count / 4 + i * 5) & 31] / 8;
        hex(x, y, br[i], 0x3A4380, 0x2A2F60, 1);
    }
}

static void draw_board(void)
{
    int i;
    for (i = 0; i < NCELLS; i++)
        hex(cx[i], cy[i] + 2, CELL + 4, 0x000000, 0x000000, 1);
    for (i = 0; i < NCELLS; i++)
        hex(cx[i], cy[i], CELL + 3, 0xBBADA0, 0x9F9284, 0);
    for (i = 0; i < NCELLS; i++)
        hex(cx[i], cy[i], TILE_R, 0xC2B6A9, 0xD4C9BD, 0);
}

static int ease_out(int t)                  /* t, result in 0..256 */
{
    int u = 256 - t;
    return 256 - (u * u >> 8);
}

static void draw_tiles(void)
{
    int i;
    if (anim_t >= 0 && anim_t < SLIDE_T) {
        int t = ease_out((anim_t + 1) * 256 / SLIDE_T);
        for (i = 0; i < nanim; i++) {
            int a = anim[i].from, b = anim[i].to;
            int x = cx[a] + (cx[b] - cx[a]) * t / 256;
            int y = cy[a] + (cy[b] - cy[a]) * t / 256;
            draw_tile(x, y, anim[i].v, 256);
        }
        return;
    }
    for (i = 0; i < NCELLS; i++) {
        int s = 256;
        if (!grid[i]) continue;
        if (anim_t >= SLIDE_T) {
            int p = (anim_t - SLIDE_T) * 256 / POP_T;
            if (fx[i] == 1) s = 256 + (wave[(p >> 4) & 15] * 3 >> 3);
            else if (fx[i] == 2) s = ease_out(p);
        }
        draw_tile(cx[i], cy[i], grid[i], s);
    }
}

static void score_box(int y, const char *label, u32 val)
{
    char buf[12];
    rect(219, y, 92, 34, 0x000000, 1);
    rect(220, y + 1, 90, 32, 0x3A3560, 1);
    text_center(265, y + 5, label, 256, 0xEEE4DA);
    utoa(val, buf);
    digits(265 - digits_width(buf, 256) / 2, y + 17, buf, 256, 0xFFFFFF);
}

static void draw_panel(void)
{
    static const char *lab[6] = { "UP", "R1", "R2", "DN", "L2", "L1" };
    int i, ccx = 265, ccy = 171;

    text_shadow(265 - text_width("HEX", 512) / 2, 10, "HEX", 512, 0xF2B179);
    {
        int w = digits_width("2048", 512);
        digits(265 - w / 2 + 2, 28, "2048", 512, 0x000000);
        digits(265 - w / 2, 26, "2048", 512, 0xEDC22E);
    }
    score_box(54, "SCORE", score);
    score_box(94, "BEST", best);

    if (popup_t) {
        char buf[14];
        buf[0] = '+';
        utoa(popup_val, buf + 1);
        text_shadow(307 - text_width(buf, 256), 59, buf, 256,
                    scale_rgb(0xF2B179, popup_t > 20 ? 256 : popup_t * 12));
    }

    /* direction compass */
    hex(ccx, ccy, 13, 0xBBADA0, 0x9F9284, 0);
    hex(ccx, ccy, 10, 0xEEE4DA, 0xCDC1B4, 0);
    for (i = 0; i < 6; i++) {
        int x = ccx + dq[i] * 27;
        int y = ccy + (2 * dr[i] + dq[i]) * 16;
        hex(ccx + dq[i] * 15, ccy + (2 * dr[i] + dq[i]) * 9, 3, 0xEDC22E, 0xF59563, 0);
        text_center(x, y - 3, lab[i], 256, 0xF2B179);
    }
    text(222, 212, "SELECT UNDO", 256, can_undo ? 0xEEE4DA : 0x6A6688);
    text(222, 224, "START  MENU", 256, 0xEEE4DA);
}

static void dim_board(void)
{
    rect(0, 0, 212, 240, 0x000000, 1);
    rect(0, 0, 212, 240, 0x000000, 1);
}

static void draw_title(void)
{
    static const u8 demo[7] = { 11, 1, 2, 3, 4, 5, 6 };
    static const s8 rq[7] = { 0, 0, 1, 1, 0, -1, -1 };
    static const s8 rr[7] = { 0, -1, -1, 0, 1, 1, 0 };
    int i, x;

    x = 160 - (text_width("HEX", 1024) + 12 + digits_width("2048", 768)) / 2;
    text_shadow(x, 16, "HEX", 1024, 0xF2B179);
    x += text_width("HEX", 1024) + 12;
    digits(x + 2, 17, "2048", 768, 0x000000);
    digits(x, 15, "2048", 768, 0xEDC22E);

    for (i = 0; i < 7; i++)
        hex(160 + rq[i] * 36, 118 + (2 * rr[i] + rq[i]) * 21, CELL + 3, 0xBBADA0, 0x9F9284, 0);
    for (i = 0; i < 7; i++) {
        int bob = wave[(frame_count / 2 + i * 4) & 31] / 32;
        draw_tile(160 + rq[i] * 36, 118 + (2 * rr[i] + rq[i]) * 21 + bob, demo[i], 256);
    }
    if ((frame_count / 24) & 1)
        text_center(160, 190, "PRESS START", 512, 0xFFFFFF);
    text_center(160, 212, "SLIDE IN SIX DIRECTIONS", 256, 0xCDC1B4);
    text_center(160, 224, "MERGE MATCHING HEXES TO REACH 2048", 256, 0xCDC1B4);
}

void game_draw(void)
{
    gpu_begin(0x000000);
    draw_background();
    if (state == ST_TITLE) {
        draw_title();
        gpu_end();
        return;
    }
    draw_board();
    draw_tiles();
    draw_panel();

    if (state == ST_PAUSE) {
        dim_board();
        text_center(BX, 80, "PAUSED", 512, 0xFFFFFF);
        text_center(BX, 116, menu_sel == 0 ? "> RESUME <" : "RESUME", 512, menu_sel == 0 ? 0xEDC22E : 0xCDC1B4);
        text_center(BX, 140, menu_sel == 1 ? "> NEW GAME <" : "NEW GAME", 512, menu_sel == 1 ? 0xEDC22E : 0xCDC1B4);
    } else if (state == ST_OVER) {
        char buf[12];
        dim_board();
        text_center(BX, 76, "GAME OVER", 768, 0xF65E3B);
        text_center(BX, 112, "SCORE", 256, 0xCDC1B4);
        utoa(score, buf);
        digits(BX - digits_width(buf, 512) / 2, 124, buf, 512, 0xFFFFFF);
        if ((frame_count / 24) & 1) text_center(BX, 160, "PRESS START", 512, 0xFFFFFF);
        if (can_undo) text_center(BX, 184, "SELECT: UNDO LAST MOVE", 256, 0xCDC1B4);
    } else if (state == ST_WIN) {
        dim_board();
        digits(BX - digits_width("2048", 768) / 2, 70, "2048", 768, 0xEDC22E);
        text_center(BX, 112, "YOU DID IT!", 512, 0xFFFFFF);
        text_center(BX, 150, "START: KEEP GOING", 256, 0xCDC1B4);
    }
    gpu_end();
}

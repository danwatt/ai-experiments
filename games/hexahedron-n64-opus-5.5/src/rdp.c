/* RDP command lists built by the CPU and sent with DPC_START/DPC_END from RDRAM.
 * No RSP involved: transform, clipping and triangle setup all run on the VR4300.
 * The triangle coefficient math is adapted from libdragon's rdpq_tri.c
 * (public domain, Unlicense). */
#include "hw.h"
#include "rdp.h"
#include "video.h"

/* Two command lists, alternated per frame: the emulator may consume a list after
   the CPU has moved on, so a list is only rewritten two frames later. */
#define CMDBUF_BYTES 0xC0000
static u32 *const cmdbuf[2] = { (u32 *)0xA0600000, (u32 *)0xA06C0000 };
static int cur;
static u32 *wp, *lim;
int rdp_tris, rdp_timeouts, rdp_dropped;

void rdp_begin(void)
{
    cur ^= 1;
    wp = cmdbuf[cur];
    lim = cmdbuf[cur] + CMDBUF_BYTES / 4 - 2048;   /* headroom for state/HUD commands */
    rdp_tris = 0; rdp_dropped = 0;
}

static inline void cmd(u32 hi, u32 lo) { wp[0] = hi; wp[1] = lo; wp += 2; }
static inline void reserve(int words) { (void)words; }

/* The previous list must be finished before DPC_START is rewritten (a START
   written while one is pending is ignored, and END would then span stale
   memory). SYNC_FULL raises the DP bit in MI_INTR, which is polled here. */
#define MI_MODE REG(0xA4300000)
#define MI_INTR REG(0xA4300008)
static int pending;
static void wait_previous(void)
{
    if (pending) {
        int g;
        for (g = 0; g < 4000000; g++) if (MI_INTR & 0x20) break;
        if (g == 4000000) rdp_timeouts++;
        pending = 0;
    }
    for (int g = 0; g < 4000000 && (DPC_STATUS & 0x400); g++) {}
    MI_MODE = 0x0800;                         /* clear DP interrupt */
}

void rdp_end(void)
{
    cmd(0x29000000, 0);                       /* sync full */
    wait_previous();
    DPC_STATUS = 0x0001 | 0x0004 | 0x0010;   /* clear XBUS, freeze, flush */
    DPC_START = PHYS(cmdbuf[cur]);
    DPC_END = PHYS(wp);
    pending = 1;
}

void rdp_sync_pipe(void) { reserve(2); cmd(0x27000000, 0); }
void rdp_sync_load(void) { reserve(2); cmd(0x26000000, 0); }
void rdp_sync_tile(void) { reserve(2); cmd(0x28000000, 0); }

void rdp_set_color_image(const void *fb, int width)
{
    reserve(2);
    cmd(0x3F000000 | (0 << 21) | (2 << 19) | (width - 1), PHYS(fb));
}
void rdp_set_z_image(const void *z) { reserve(2); cmd(0x3E000000, PHYS(z)); }
void rdp_set_scissor(int x0, int y0, int x1, int y1)
{
    reserve(2);
    cmd(0x2D000000 | ((x0 * 4) << 12) | (y0 * 4), ((x1 * 4) << 12) | (y1 * 4));
}
void rdp_set_other_modes(u64 som) { reserve(2); cmd(0x2F000000 | (u32)((som >> 32) & 0x00FFFFFF), (u32)som); }
void rdp_set_combine(u64 cc) { reserve(2); cmd(0x3C000000 | (u32)((cc >> 32) & 0x00FFFFFF), (u32)cc); }
void rdp_set_fill_color(u32 c) { reserve(2); cmd(0x37000000, c); }
void rdp_set_prim_color(u32 rgba) { reserve(2); cmd(0x3A000000, rgba); }
void rdp_set_env_color(u32 rgba) { reserve(2); cmd(0x3B000000, rgba); }
void rdp_set_blend_color(u32 rgba) { reserve(2); cmd(0x39000000, rgba); }

/* Fill/copy mode rectangle, inclusive pixel bounds. */
void rdp_fill_rect(int x0, int y0, int x1, int y1)
{
    reserve(2);
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > SCR_W - 1) x1 = SCR_W - 1;
    if (y1 > SCR_H - 1) y1 = SCR_H - 1;
    if (x1 < x0 || y1 < y0) return;
    cmd(0x36000000 | ((x1 * 4) << 12) | (y1 * 4), ((x0 * 4) << 12) | (y0 * 4));
}

/* 1/2-cycle mode rectangle (exclusive bounds), used for HUD bars and tints. */
void rdp_rect(int x0, int y0, int x1, int y1)
{
    reserve(2);
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > SCR_W) x1 = SCR_W;
    if (y1 > SCR_H) y1 = SCR_H;
    if (x1 <= x0 || y1 <= y0) return;
    cmd(0x36000000 | ((x1 * 4) << 12) | (y1 * 4), ((x0 * 4) << 12) | (y0 * 4));
}

/* Upload a 32x32 RGBA16 texture into TMEM and set tile 0 to wrap it. */
void rdp_load_texture32(const u16 *tex)
{
    reserve(16);
    cmd(0x27000000, 0);                                          /* sync pipe */
    cmd(0x28000000, 0);                                          /* sync tile */
    cmd(0x3D000000 | (0 << 21) | (2 << 19) | (32 - 1), PHYS(tex)); /* texture image */
    cmd(0x35000000 | (0 << 21) | (2 << 19) | (0 << 9) | 0, 7 << 24); /* tile 7: load */
    cmd(0x26000000, 0);                                          /* sync load */
    cmd(0x33000000, (7u << 24) | ((32 * 32 - 1) << 12) | 256);   /* load block: dxt = 2048/8 */
    cmd(0x28000000, 0);
    cmd(0x35000000 | (0 << 21) | (2 << 19) | (8 << 9) | 0,
        (0u << 24) | (5 << 14) | (5 << 4));                      /* tile 0: 8 words/line, wrap 32x32 */
    cmd(0x32000000, (0u << 24) | ((31 * 4) << 12) | (31 * 4));   /* tile size */
}

/* ---------------------------------------------------------------- triangles */
static inline float flo(float f) { int i = (int)f; return (float)(i - (f < (float)i)); }
static inline float fab(float f) { return f < 0 ? -f : f; }
static inline s32 s16_16(float f)
{
    if (f >= 32767.f) return 0x7FFFFFFF;
    if (f < -32768.f) return (s32)0x80000000;
    return (s32)(f * 65536.f);   /* truncation: sub-1/65536 error, far cheaper than floor */
}
static inline s32 clampi(s32 v, s32 lo, s32 hi) { return v < lo ? lo : v > hi ? hi : v; }

typedef struct { float hx, hy, mx, my, fy, ish, attr; } edge_t;

/* v: [x, y, z, r, g, b, a, s, t, invw]. flags: TRI_SHADE | TRI_TEX | TRI_Z */
void rdp_triangle(int flags, const float *v1, const float *v2, const float *v3)
{
    const float *t;
    if (v1[1] > v2[1]) { t = v1; v1 = v2; v2 = t; }
    if (v2[1] > v3[1]) { t = v2; v2 = v3; v3 = t; }
    if (v1[1] > v2[1]) { t = v1; v1 = v2; v2 = t; }

    if (v1[1] < -2000 || v3[1] > 2240) return;
    {
        float mnx = v1[0], mxx = v1[0];
        if (v2[0] < mnx) mnx = v2[0]; if (v2[0] > mxx) mxx = v2[0];
        if (v3[0] < mnx) mnx = v3[0]; if (v3[0] > mxx) mxx = v3[0];
        if (mnx < -2000 || mxx > 2320 || mxx < 0 || mnx > SCR_W || v3[1] < 0 || v1[1] > SCR_H) return;
    }
    if (wp + 44 > lim) { rdp_dropped++; return; }
    u32 id = 0x08 | ((flags & TRI_SHADE) ? 4 : 0) | ((flags & TRI_TEX) ? 2 : 0) | ((flags & TRI_Z) ? 1 : 0);
    rdp_tris++;

    edge_t d;
    const float x1 = v1[0], x2 = v2[0], x3 = v3[0];
    s32 y1f = clampi((s32)flo(v1[1] * 4), -4096 * 4, 4095 * 4);
    s32 y2f = clampi((s32)flo(v2[1] * 4), -4096 * 4, 4095 * 4);
    s32 y3f = clampi((s32)flo(v3[1] * 4), -4096 * 4, 4095 * 4);
    /* Flat-bottom triangles (YM == YL) come out empty in the emulated RDP;
       push the last vertex down one sub-scanline so the low edge has length. */
    if (y3f == y2f && y2f > y1f) y3f++;
    const float y1 = y1f * 0.25f, y2 = y2f * 0.25f, y3 = y3f * 0.25f;
    d.hx = x3 - x1; d.hy = y3 - y1; d.mx = x2 - x1; d.my = y2 - y1;
    float lx = x3 - x2, ly = y3 - y2;
    float nz = d.hx * d.my - d.hy * d.mx;
    d.attr = fab(nz) > 1e-30f ? -1.0f / nz : 0;
    u32 lft = nz < 0;
    d.ish = fab(d.hy) > 1e-30f ? d.hx / d.hy : 0;
    float ism = fab(d.my) > 1e-30f ? d.mx / d.my : 0;
    float isl = fab(ly) > 1e-30f ? lx / ly : 0;
    d.fy = flo(y1) - y1;
    float xh = x1 + d.fy * d.ish, xm = x1 + d.fy * ism, xl = x2;

    wp[0] = (id << 24) | (lft << 23) | (0 << 16) | ((u32)y3f & 0x3FFF);
    wp[1] = (((u32)y2f & 0x3FFF) << 16) | ((u32)y1f & 0x3FFF);
    wp[2] = s16_16(xl); wp[3] = s16_16(isl);
    wp[4] = s16_16(xh); wp[5] = s16_16(d.ish);
    wp[6] = s16_16(xm); wp[7] = s16_16(ism);
    wp += 8;

    if (flags & TRI_SHADE) {
        const float *a = v1 + 3, *b = v2 + 3, *c = v3 + 3;
        float m[4], h[4];
        s32 f[4], dx[4], de[4], dy[4];
        for (int i = 0; i < 4; i++) {
            m[i] = (b[i] - a[i]) * 255.f;
            h[i] = (c[i] - a[i]) * 255.f;
            float nx = d.hy * m[i] - d.my * h[i];
            float ny = d.mx * h[i] - d.hx * m[i];
            float DDx = nx * d.attr, DDy = ny * d.attr, DDe = DDy + DDx * d.ish;
            f[i] = s16_16(a[i] * 255.f + d.fy * DDe);
            dx[i] = s16_16(DDx); de[i] = s16_16(DDe); dy[i] = s16_16(DDy);
        }
        wp[0] = (f[0] & 0xffff0000) | (0xffff & (f[1] >> 16));
        wp[1] = (f[2] & 0xffff0000) | (0xffff & (f[3] >> 16));
        wp[2] = (dx[0] & 0xffff0000) | (0xffff & (dx[1] >> 16));
        wp[3] = (dx[2] & 0xffff0000) | (0xffff & (dx[3] >> 16));
        wp[4] = (f[0] << 16) | (f[1] & 0xffff);
        wp[5] = (f[2] << 16) | (f[3] & 0xffff);
        wp[6] = (dx[0] << 16) | (dx[1] & 0xffff);
        wp[7] = (dx[2] << 16) | (dx[3] & 0xffff);
        wp[8] = (de[0] & 0xffff0000) | (0xffff & (de[1] >> 16));
        wp[9] = (de[2] & 0xffff0000) | (0xffff & (de[3] >> 16));
        wp[10] = (dy[0] & 0xffff0000) | (0xffff & (dy[1] >> 16));
        wp[11] = (dy[2] & 0xffff0000) | (0xffff & (dy[3] >> 16));
        wp[12] = (de[0] << 16) | (de[1] & 0xffff);
        wp[13] = (de[2] << 16) | (de[3] & 0xffff);
        wp[14] = (dy[0] << 16) | (dy[1] & 0xffff);
        wp[15] = (dy[2] << 16) | (dy[3] & 0xffff);
        wp += 16;
    }

    if (flags & TRI_TEX) {
        float s1 = v1[7] * 32.f, t1 = v1[8] * 32.f, w1 = v1[9];
        float s2 = v2[7] * 32.f, t2 = v2[8] * 32.f, w2 = v2[9];
        float s3 = v3[7] * 32.f, t3 = v3[8] * 32.f, w3 = v3[9];
        float mw = w1 > w2 ? w1 : w2; if (w3 > mw) mw = w3;
        float minw = 1.0f / mw;
        w1 *= minw; w2 *= minw; w3 *= minw;
        s1 *= w1; t1 *= w1; s2 *= w2; t2 *= w2; s3 *= w3; t3 *= w3;
        w1 *= 0x7FFF; w2 *= 0x7FFF; w3 *= 0x7FFF;
        float ms = s2 - s1, mt = t2 - t1, mww = w2 - w1;
        float hs = s3 - s1, ht = t3 - t1, hw = w3 - w1;
        float DsDx = (d.hy * ms - d.my * hs) * d.attr, DtDx = (d.hy * mt - d.my * ht) * d.attr, DwDx = (d.hy * mww - d.my * hw) * d.attr;
        float DsDy = (d.mx * hs - d.hx * ms) * d.attr, DtDy = (d.mx * ht - d.hx * mt) * d.attr, DwDy = (d.mx * hw - d.hx * mww) * d.attr;
        float DsDe = DsDy + DsDx * d.ish, DtDe = DtDy + DtDx * d.ish, DwDe = DwDy + DwDx * d.ish;
        s32 fs = s16_16(s1 + d.fy * DsDe), ft = s16_16(t1 + d.fy * DtDe), fw = s16_16(w1 + d.fy * DwDe);
        s32 sx = s16_16(DsDx), tx = s16_16(DtDx), wx = s16_16(DwDx);
        s32 se = s16_16(DsDe), te = s16_16(DtDe), we = s16_16(DwDe);
        s32 sy = s16_16(DsDy), ty = s16_16(DtDy), wy = s16_16(DwDy);
        wp[0] = (fs & 0xffff0000) | (0xffff & (ft >> 16));
        wp[1] = (fw & 0xffff0000);
        wp[2] = (sx & 0xffff0000) | (0xffff & (tx >> 16));
        wp[3] = (wx & 0xffff0000);
        wp[4] = (fs << 16) | (ft & 0xffff);
        wp[5] = (fw << 16);
        wp[6] = (sx << 16) | (tx & 0xffff);
        wp[7] = (wx << 16);
        wp[8] = (se & 0xffff0000) | (0xffff & (te >> 16));
        wp[9] = (we & 0xffff0000);
        wp[10] = (sy & 0xffff0000) | (0xffff & (ty >> 16));
        wp[11] = (wy & 0xffff0000);
        wp[12] = (se << 16) | (te & 0xffff);
        wp[13] = (we << 16);
        wp[14] = (sy << 16) | (ty & 0xffff);
        wp[15] = (wy << 16);
        wp += 16;
    }

    if (flags & TRI_Z) {
        float z1 = v1[2] * 0x7FFF, z2 = v2[2] * 0x7FFF, z3 = v3[2] * 0x7FFF;
        float mz = z2 - z1, hz = z3 - z1;
        float DzDx = (d.hy * mz - d.my * hz) * d.attr;
        float DzDy = (d.mx * hz - d.hx * mz) * d.attr;
        float DzDe = DzDy + DzDx * d.ish;
        wp[0] = s16_16(z1 + d.fy * DzDe);
        wp[1] = s16_16(DzDx);
        wp[2] = s16_16(DzDe);
        wp[3] = s16_16(DzDy);
        wp += 4;
    }
}

/* ---------------------------------------------------------------- HUD font */
/* Load a w x h I4 image into TMEM and describe it as tile 0 (clamped). */
void rdp_load_font(const u8 *i4, int w, int h)
{
    int texels16 = w * h / 4, line = w / 16;
    cmd(0x27000000, 0);
    cmd(0x28000000, 0);
    cmd(0x3D000000 | (0 << 21) | (2 << 19) | (w / 4 - 1), PHYS(i4));
    cmd(0x35000000 | (0 << 21) | (2 << 19), 7u << 24);
    cmd(0x26000000, 0);
    cmd(0x33000000, (7u << 24) | ((u32)(texels16 - 1) << 12) | (u32)(2048 / line));
    cmd(0x28000000, 0);
    cmd(0x35000000 | (4 << 21) | (0 << 19) | ((u32)line << 9), (0u << 24) | (1 << 19) | (1 << 9));
    cmd(0x32000000, (0u << 24) | ((u32)((w - 1) * 4) << 12) | (u32)((h - 1) * 4));
}

/* Texture rectangle in 1-cycle mode: screen [x0,x1) x [y0,y1), texel origin s,t,
   steps per pixel dsdx, dtdy. */
void rdp_tex_rect(int tile, float x0, float y0, float x1, float y1, float s, float t, float dsdx, float dtdy)
{
    if (x1 <= 0 || y1 <= 0 || x0 >= SCR_W || y0 >= SCR_H) return;
    if (x0 < 0) { s -= x0 * dsdx; x0 = 0; }
    if (y0 < 0) { t -= y0 * dtdy; y0 = 0; }
    u32 xh = (u32)(x0 * 4), yh = (u32)(y0 * 4), xl = (u32)(x1 * 4), yl = (u32)(y1 * 4);
    cmd(0x24000000 | (xl << 12) | yl, ((u32)tile << 24) | (xh << 12) | yh);
    cmd(((u32)(s32)(s * 32) << 16) | ((u32)(s32)(t * 32) & 0xFFFF),
        ((u32)(s32)(dsdx * 1024) << 16) | ((u32)(s32)(dtdy * 1024) & 0xFFFF));
}

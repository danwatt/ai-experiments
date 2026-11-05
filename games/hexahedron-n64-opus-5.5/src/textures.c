/* Procedural 32x32 RGBA16 wall textures, built at boot (one TMEM load each). */
#include "hw.h"
#include "level.h"
#include "textures.h"

u16 textures[TEX_COUNT][32 * 32] __attribute__((aligned(16)));

static u32 hash(int x, int y, int s)
{
    u32 h = (u32)x * 374761393u + (u32)y * 668265263u + (u32)s * 1274126177u;
    h = (h ^ (h >> 13)) * 1274126177u;
    return h ^ (h >> 16);
}
static float n01(int x, int y, int s) { return (hash(x & 31, y & 31, s) & 0xFFFF) / 65535.0f; }
/* tileable value noise with period 32 / cell */
static float vnoise(int x, int y, int cell, int s)
{
    int x0 = x / cell, y0 = y / cell, per = 32 / cell;
    float fx = (float)(x % cell) / cell, fy = (float)(y % cell) / cell;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    float a = n01(x0 % per, y0 % per, s), b = n01((x0 + 1) % per, y0 % per, s);
    float c = n01(x0 % per, (y0 + 1) % per, s), d = n01((x0 + 1) % per, (y0 + 1) % per, s);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}
static float fbm(int x, int y, int s) { return vnoise(x, y, 16, s) * 0.5f + vnoise(x, y, 8, s + 1) * 0.3f + vnoise(x, y, 4, s + 2) * 0.2f; }

static u16 px(float r, float g, float b)
{
    int R = (int)(r * 31.0f + 0.5f), G = (int)(g * 31.0f + 0.5f), B = (int)(b * 31.0f + 0.5f);
    if (R < 0) R = 0; if (R > 31) R = 31;
    if (G < 0) G = 0; if (G > 31) G = 31;
    if (B < 0) B = 0; if (B > 31) B = 31;
    return (u16)((R << 11) | (G << 6) | (B << 1) | 1);
}

void textures_init(void)
{
    for (int y = 0; y < 32; y++) for (int x = 0; x < 32; x++) {
        float n = fbm(x, y, 7), fine = n01(x, y, 3) * 0.08f;
        int edge = x == 0 || y == 0, edge2 = x == 31 || y == 31;
        float r, g, b, v;

        /* metal: two plates, seams, rivets */
        v = 0.50f + n * 0.18f + fine;
        if (x == 0 || y == 0 || y == 16) v = 0.22f;
        if (x == 1 || y == 1 || y == 17) v += 0.16f;
        if ((x == 3 || x == 28) && (y == 3 || y == 13 || y == 19 || y == 29)) v = 0.85f;
        textures[TEX_METAL][y * 32 + x] = px(v * 0.95f, v * 0.98f, v * 1.05f);

        /* tech: blue panels with a lit strip */
        v = 0.36f + n * 0.14f + fine;
        r = v * 0.8f; g = v * 0.92f; b = v * 1.2f;
        if (edge || x == 15) { r = g = b = 0.16f; }
        if (x >= 6 && x <= 9 && y >= 5 && y <= 26) { r = 0.25f; g = 0.55f; b = 0.85f; if (y % 4 == 0) { r = 0.7f; g = 0.95f; b = 1; } }
        if (x >= 20 && x <= 27 && y >= 8 && y <= 11) { r = 0.18f; g = 0.2f; b = 0.25f; }
        textures[TEX_TECH][y * 32 + x] = px(r, g, b);

        /* floor: dark tread plate */
        v = 0.30f + n * 0.12f + fine;
        if (((x + y) & 7) == 0 || ((x - y + 64) & 7) == 0) v += 0.10f;
        if (edge) v = 0.14f;
        textures[TEX_FLOOR][y * 32 + x] = px(v, v * 0.98f, v * 0.94f);

        /* grate: bars over a dark void */
        v = ((x & 7) < 2 || (y & 7) < 2) ? 0.50f + n * 0.15f : 0.07f + n * 0.05f;
        textures[TEX_GRATE][y * 32 + x] = px(v * 0.9f, v * 0.95f, v);

        /* panel: light grey cladding */
        v = 0.62f + n * 0.12f + fine;
        if (y == 0 || x == 0) v = 0.30f;
        if ((y == 10 || y == 21) && x > 2 && x < 29) v = 0.45f;
        textures[TEX_PANEL][y * 32 + x] = px(v, v, v * 1.04f);

        /* hazard: diagonal yellow / black stripe band through the middle */
        if (y >= 10 && y <= 21) {
            int s = ((x + y) / 4) & 1;
            r = s ? 0.95f : 0.1f; g = s ? 0.75f : 0.1f; b = s ? 0.1f : 0.08f;
            r *= 0.8f + n * 0.3f; g *= 0.8f + n * 0.3f;
        } else { v = 0.42f + n * 0.15f + fine; r = v; g = v; b = v * 1.05f; if (y == 9 || y == 22) r = g = b = 0.2f; }
        textures[TEX_HAZARD][y * 32 + x] = px(r, g, b);

        /* pipes: three horizontal pipes with highlights */
        {
            int py = y % 11;
            float sh = py < 9 ? 0.25f + 0.6f * (1 - ((py - 4) * (py - 4)) / 16.0f) : 0.08f;
            r = sh * 0.6f; g = sh * 0.85f; b = sh * 0.6f;
            if (py < 9 && (x == 10 || x == 26)) { r *= 0.5f; g *= 0.5f; b *= 0.5f; }
            r += fine; g += fine;
        }
        textures[TEX_PIPES][y * 32 + x] = px(r, g, b);

        /* rock */
        v = 0.25f + fbm(x, y, 21) * 0.45f + fine * 1.5f;
        textures[TEX_ROCK][y * 32 + x] = px(v * 1.0f, v * 0.85f, v * 0.68f);

        /* lava rock: dark basalt with glowing cracks */
        v = fbm(x, y, 33);
        {
            float crack = absf(vnoise(x, y, 8, 41) - 0.5f);
            r = 0.18f + v * 0.2f; g = 0.1f + v * 0.1f; b = 0.08f + v * 0.06f;
            if (crack < 0.05f) { r = 0.95f; g = 0.4f; b = 0.08f; }
        }
        textures[TEX_LAVAROCK][y * 32 + x] = px(r, g, b);

        /* lava */
        v = fbm(x, y, 55);
        textures[TEX_LAVA][y * 32 + x] = px(0.85f + v * 0.15f, 0.25f + v * 0.55f, 0.02f + v * 0.12f);

        /* crystal: bright faceted blue */
        v = vnoise(x, y, 8, 61);
        {
            float f = (float)(((x * 3 + y * 5) / 7) % 4) / 4.0f;
            r = 0.2f + v * 0.3f + f * 0.2f; g = 0.45f + v * 0.35f + f * 0.2f; b = 0.75f + v * 0.25f;
        }
        textures[TEX_CRYSTAL][y * 32 + x] = px(r, g, b);

        /* light panel */
        v = (edge || edge2) ? 0.3f : (x < 3 || y < 3 || x > 28 || y > 28) ? 0.6f : 0.95f + fine * 0.5f;
        textures[TEX_LIGHT][y * 32 + x] = px(v, v, v);

        /* door: heavy plate with a centre seam and chevrons (tinted per door type by shade) */
        v = 0.55f + n * 0.12f + fine;
        if (x == 15 || x == 16) v = 0.12f;
        {
            int cy = y - 16, ax = x < 16 ? 15 - x : x - 16;
            if (ax >= 3 && ax <= 12 && (cy + 20 - ax / 2 + 32) % 8 < 3) v = 0.92f;
        }
        if (edge || edge2) v = 0.2f;
        textures[TEX_DOOR][y * 32 + x] = px(v, v, v);
    }
}

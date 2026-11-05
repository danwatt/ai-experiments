/* Mission data (exported from the browser game's level.js by tools/export.mjs),
 * cell lookup, sphere collision and ray casts against the cube walls. */
#include "level.h"

level_t L;

static const u8 *rp, *rbase;
static u8 g8(void) { return *rp++; }
static u16 g16(void) { u16 v = (u16)((rp[0] << 8) | rp[1]); rp += 2; return v; }
static u32 g32(void) { u32 v = ((u32)rp[0] << 24) | ((u32)rp[1] << 16) | ((u32)rp[2] << 8) | rp[3]; rp += 4; return v; }
static float gf(void) { union { u32 u; float f; } c; c.u = g32(); return c.f; }
static vec3 gv(void) { vec3 v; v.x = gf(); v.y = gf(); v.z = gf(); return v; }
static void gstr(char *out, int max)
{
    int n = g16();
    for (int i = 0; i < n; i++) { char c = (char)g8(); if (i < max - 1) out[i] = c; }
    out[n < max - 1 ? n : max - 1] = 0;
}
static void galign(void) { while ((rp - rbase) & 3) rp++; }

static void make_tri(ctri_t *t, vec3 a, vec3 b, vec3 c, vec3 n, int door, int lava)
{
    t->a = a; t->e1 = vsub(b, a); t->e2 = vsub(c, a); t->n = n; t->door = (s16)door; t->lava = (u8)lava; t->stamp = 0;
}

void level_load(int mission)
{
    u32 size, off = rom_file(mission, &size);
    u8 *buf = halloc(size + 16);
    rom_read(buf, off, (size + 1) & ~1u);
    rp = rbase = buf;

    g32();
    L.ncells = g16(); L.nwalls = g16(); L.ndoors = g16(); L.nregions = g16(); L.nenemies = g16(); L.npickups = g16();
    gstr(L.name, sizeof L.name); gstr(L.text, sizeof L.text);
    for (int i = 0; i < 5; i++) gstr(L.obj[i], sizeof L.obj[i]);
    gstr(L.reactor_name, sizeof L.reactor_name);
    L.start = gv(); L.yaw = gf();
    L.has_reactor = g8(); L.reactor = gv();
    for (int i = 0; i < 3; i++) { L.has_key[i] = g8(); L.key[i] = gv(); }
    L.nexit = g8();
    for (int i = 0; i < L.nexit; i++) { u16 e = g16(); if (i < 4) L.exits[i] = e; }
    if (L.nexit > 4) L.nexit = 4;
    galign();

    L.regions = halloc(sizeof(region_t) * L.nregions);
    for (int i = 0; i < L.nregions; i++) {
        region_t *r = &L.regions[i];
        gstr(r->name, sizeof r->name);
        r->sector = g8(); r->lava = g8();
        for (int k = 0; k < 3; k++) r->light[k] = g8();
        for (int k = 0; k < 3; k++) r->amb[k] = g8();
    }
    galign();

    L.cells = halloc(sizeof(cell_t) * L.ncells);
    for (int i = 0; i < L.ncells; i++) {
        cell_t *c = &L.cells[i];
        c->x = (s16)g16(); c->y = (s16)g16(); c->z = (s16)g16(); c->region = g16();
        for (int d = 0; d < 6; d++) c->nbr[d] = (s16)g16();
        for (int d = 0; d < 6; d++) c->door[d] = (s16)g16();
        for (int d = 0; d < 6; d++) c->ftype[d] = g8();
        g16();
        c->center = gv();
        for (int d = 0; d < 6; d++) { c->fc[d] = gv(); c->fn[d] = gv(); }
        c->seen = c->visited = 0; c->stamp = 0; c->flow = -1;
    }
    for (int i = 0; i < L.ncells; i++) { L.cells[i].wall0 = g16(); L.cells[i].nwall = g16(); }

    L.walls = halloc(sizeof(wall_t) * L.nwalls);
    L.tris = halloc(sizeof(ctri_t) * 2 * (L.nwalls + L.ndoors));
    for (int i = 0; i < L.nwalls; i++) {
        wall_t *w = &L.walls[i];
        w->tex = g8(); w->flags = g8(); w->cell = g16();
        for (int k = 0; k < 4; k++) w->p[k] = gv();
        w->n = gv();
        for (int k = 0; k < 5; k++) for (int c = 0; c < 3; c++) w->col[k][c] = g8();
        g8();
        make_tri(&L.tris[2 * i], w->p[0], w->p[1], w->p[2], w->n, -1, w->flags & 1);
        make_tri(&L.tris[2 * i + 1], w->p[0], w->p[2], w->p[3], w->n, -1, w->flags & 1);
    }

    L.doors = halloc(sizeof(door_t) * (L.ndoors ? L.ndoors : 1));
    for (int i = 0; i < L.ndoors; i++) {
        door_t *d = &L.doors[i];
        d->a = g16(); d->b = g16(); d->dir = g8(); d->type = g8(); d->oneway = g8(); d->flip = g8();
        for (int k = 0; k < 4; k++) d->p[k] = gv();
        d->n = gv(); d->c = gv();
        for (int k = 0; k < 3; k++) d->light[k] = g8();
        g8();
        d->state = 0; d->t = 0; d->warn = 0; d->stamp = 0;
        int ti = 2 * (L.nwalls + i);
        make_tri(&L.tris[ti], d->p[0], d->p[1], d->p[2], d->n, i, 0);
        make_tri(&L.tris[ti + 1], d->p[0], d->p[2], d->p[3], d->n, i, 0);
    }

    L.gx = (s16)g16(); L.gy = (s16)g16(); L.gz = (s16)g16();
    L.dx = (s16)g16(); L.dy = (s16)g16(); L.dz = (s16)g16();
    int nslots = L.dx * L.dy * L.dz;
    L.cellgrid = (s16 *)rp; rp += 2 * nslots;      /* used in place: big-endian matches */
    galign();
    L.slot = (u32 *)rp; rp += 4 * (nslots + 1);
    L.ids = (u16 *)rp; rp += 2 * L.slot[nslots];
    galign();

    L.enemies = halloc(sizeof(spawn_t) * (L.nenemies ? L.nenemies : 1));
    for (int i = 0; i < L.nenemies; i++) { L.enemies[i].type = g8(); L.enemies[i].big = g8(); g16(); L.enemies[i].pos = gv(); }
    L.pickups = halloc(sizeof(spawn_t) * (L.npickups ? L.npickups : 1));
    for (int i = 0; i < L.npickups; i++) { L.pickups[i].type = g8(); g8(); g16(); L.pickups[i].pos = gv(); }
}

static inline int slot_index(int x, int y, int z)
{
    x -= L.gx; y -= L.gy; z -= L.gz;
    if (x < 0 || y < 0 || z < 0 || x >= L.dx || y >= L.dy || z >= L.dz) return -1;
    return (x * L.dy + y) * L.dz + z;
}

int level_cell_at(int x, int y, int z)
{
    int s = slot_index(x, y, z);
    return s < 0 ? -1 : L.cellgrid[s];
}

static int inside(const cell_t *c, vec3 p)
{
    for (int d = 0; d < 6; d++)
        if (vdot(vsub(p, c->fc[d]), c->fn[d]) < -0.05f) return 0;
    return 1;
}

int level_find_cell(vec3 p, int hint)
{
    if (hint >= 0) {
        const cell_t *h = &L.cells[hint];
        if (inside(h, p)) return hint;
        for (int d = 0; d < 6; d++) if (h->nbr[d] >= 0 && inside(&L.cells[h->nbr[d]], p)) return h->nbr[d];
    }
    int bx = floori(p.x / CELL_S), by = floori(p.y / CELL_S), bz = floori(p.z / CELL_S);
    int best = -1; float bd = 1e30f;
    for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) for (int dz = -1; dz <= 1; dz++) {
        int ci = level_cell_at(bx + dx, by + dy, bz + dz);
        if (ci < 0) continue;
        if (inside(&L.cells[ci], p)) return ci;
        float d = vlen2(vsub(p, L.cells[ci].center));
        if (d < bd) { bd = d; best = ci; }
    }
    return best >= 0 ? best : hint;
}

static inline int tri_solid(const ctri_t *t) { return t->door < 0 || L.doors[t->door].t < 0.55f; }

static vec3 closest_pt(vec3 p, const ctri_t *t)
{
    vec3 ab = t->e1, ac = t->e2, ap = vsub(p, t->a);
    float d1 = vdot(ab, ap), d2 = vdot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return t->a;
    vec3 b = vadd(t->a, ab), c = vadd(t->a, ac);
    vec3 bp = vsub(p, b);
    float d3 = vdot(ab, bp), d4 = vdot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return b;
    float vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) return vmad(t->a, ab, d1 / (d1 - d3));
    vec3 cp = vsub(p, c);
    float d5 = vdot(ab, cp), d6 = vdot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return c;
    float vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) return vmad(t->a, ac, d2 / (d2 - d6));
    float va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return vmad(b, vsub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6)));
    float den = 1 / (va + vb + vc);
    return vadd(t->a, vadd(vmul(ab, vb * den), vmul(ac, vc * den)));
}

float dist2_tri(vec3 p, const ctri_t *t) { return vlen2(vsub(p, closest_pt(p, t))); }

void collide_sphere(vec3 *pos, vec3 *vel, float r, float bounce, collide_t *res)
{
    res->hit = 0; res->lava = 0; res->door = -1;
    for (int iter = 0; iter < 3; iter++) {
        int moved = 0;
        int s = slot_index(floori(pos->x / CELL_S), floori(pos->y / CELL_S), floori(pos->z / CELL_S));
        if (s < 0) return;
        for (u32 k = L.slot[s]; k < L.slot[s + 1]; k++) {
            int q = L.ids[k];
            for (int h = 0; h < 2; h++) {
                const ctri_t *t = &L.tris[2 * q + h];
                if (!tri_solid(t)) continue;
                vec3 c = closest_pt(*pos, t);
                vec3 dv = vsub(*pos, c);
                float d2 = vlen2(dv);
                if (t->lava && d2 < (r + 0.6f) * (r + 0.6f)) res->lava = 1;
                if (d2 >= r * r) continue;
                float d = sqrtf_(d2);
                vec3 n;
                if (d < 1e-5f) { n = t->n; d = 0; } else n = vmul(dv, 1.0f / d);
                *pos = vmad(*pos, n, r - d);
                if (vel) {
                    float vn = vdot(*vel, n);
                    if (vn < 0) *vel = vmad(*vel, n, -vn * (1 + bounce));
                }
                res->hit = 1;
                if (t->door >= 0) res->door = t->door;
                moved = 1;
            }
        }
        if (!moved) break;
    }
}

static int ray_stamp;
float raycast(vec3 p0, vec3 p1, ctri_t **hit)
{
    ray_stamp++;
    vec3 dv = vsub(p1, p0);
    float len = vlen(dv);
    int steps = (int)(len / 2.5f) + 1;
    float best = 2;
    ctri_t *bt = NULL;
    int last = -1;
    for (int st = 0; st <= steps; st++) {
        float f = (float)st / steps;
        vec3 p = vmad(p0, dv, f);
        int s = slot_index(floori(p.x / CELL_S), floori(p.y / CELL_S), floori(p.z / CELL_S));
        if (s < 0 || s == last) continue;
        last = s;
        for (u32 k = L.slot[s]; k < L.slot[s + 1]; k++) {
            int q = L.ids[k];
            for (int h = 0; h < 2; h++) {
                ctri_t *t = &L.tris[2 * q + h];
                if (t->stamp == ray_stamp) continue;
                t->stamp = ray_stamp;
                if (!tri_solid(t)) continue;
                vec3 pv = vcross(dv, t->e2);
                float det = vdot(t->e1, pv);
                if (det > -1e-9f && det < 1e-9f) continue;
                float inv = 1 / det;
                vec3 tv = vsub(p0, t->a);
                float u = vdot(tv, pv) * inv;
                if (u < 0 || u > 1) continue;
                vec3 qv = vcross(tv, t->e1);
                float v = vdot(dv, qv) * inv;
                if (v < 0 || u + v > 1) continue;
                float tt = vdot(t->e2, qv) * inv;
                if (tt >= 0 && tt <= 1 && tt < best) { best = tt; bt = t; }
            }
        }
    }
    if (hit) *hit = bt;
    return best;
}

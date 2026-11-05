/* World and object rendering. Visible cells come from a portal walk out of the
 * camera's cell (each open face narrows a screen rectangle); their walls are
 * lit per vertex (baked light + headlight + flashes, faded by distance), clipped
 * in view space and sent to the RDP as textured, shaded, z-buffered triangles. */
#include "render.h"
#include "level.h"
#include "rdp.h"
#include "video.h"
#include "textures.h"

typedef struct { float x, y, z, r, g, b, a, s, t; } rv_t;

static vec3 cam;
static basis_t cb;
static int cam_cell_i;
static float rtime;
static int stamp;
static int mode = -1;
int r_cells_drawn, r_walls_drawn;

#define MAXVIS 700
static int vis[MAXVIS], nvis;
static u16 bucket[TEX_COUNT][1200];
static int nbucket[TEX_COUNT];
static int cur_tex = -1;

#define MAXDL 6
static struct { vec3 p; float r2, inv, cr, cg, cb; } dl[MAXDL];
static int ndl;

enum { M_TEX, M_SHADE, M_ADD, M_TINT, M_SHADE_ALPHA, M_TEXT };

static void set_mode(int m)
{
    if (m == mode) return;
    mode = m;
    rdp_sync_pipe();
    u64 base = SOM_CYCLE_1 | SOM_PERSP | SOM_TF_RGB | SOM_DITHER_SQ | SOM_ADITHER_NONE;
    switch (m) {
    case M_TEX:
        rdp_set_other_modes(base | SOM_PERSP | SOM_SAMPLE_POINT | BLEND_OPAQUE | SOM_Z_WRITE | SOM_Z_COMPARE);
        rdp_set_combine(CC_TEX_SHADE);
        break;
    case M_SHADE:
        rdp_set_other_modes(base | BLEND_OPAQUE | SOM_Z_WRITE | SOM_Z_COMPARE);
        rdp_set_combine(CC_SHADE);
        break;
    case M_SHADE_ALPHA:
        rdp_set_other_modes(base | BLEND_ALPHA | SOM_Z_COMPARE | SOM_ZMODE_TRANSP);
        rdp_set_combine(CC_SHADE);
        break;
    case M_ADD:
        rdp_set_other_modes(base | BLEND_ADD | SOM_Z_COMPARE | SOM_ZMODE_TRANSP);
        rdp_set_combine(CC_SHADE);
        break;
    case M_TINT:   /* 1-cycle rectangles in the primitive colour */
        rdp_set_other_modes((base & ~SOM_PERSP) | BLEND_ALPHA);
        rdp_set_combine(CC_PRIM);
        break;
    case M_TEXT:   /* texture rectangles: I4 font alpha x primitive colour */
        rdp_set_other_modes(SOM_CYCLE_1 | SOM_TF_RGB | SOM_DITHER_NONE | SOM_ADITHER_NONE | SOM_SAMPLE_POINT | BLEND_ALPHA);
        rdp_set_combine(CC_TEXT);
        break;
    }
}

static void bind_tex(int t)
{
    if (t == cur_tex) return;
    cur_tex = t;
    rdp_load_texture32(textures[t]);
}

void r_light(vec3 pos, float radius, float r, float g, float b)
{
    if (ndl >= MAXDL) return;
    dl[ndl].p = pos; dl[ndl].r2 = radius * radius; dl[ndl].inv = 1.0f / radius;
    dl[ndl].cr = r; dl[ndl].cg = g; dl[ndl].cb = b;
    ndl++;
}

static inline vec3 to_view(vec3 p)
{
    vec3 d = vsub(p, cam);
    return v3(vdot(d, cb.r), vdot(d, cb.u), vdot(d, cb.f));
}

/* Lit, fogged vertex colour. base is 0..1. */
static inline void light_vertex(rv_t *o, vec3 world, float vz, float br, float bg, float bb)
{
    float d2 = vlen2(vsub(world, cam));
    /* headlight */
    float h = 1.0f - d2 * (1.0f / (38.0f * 38.0f));
    if (h > 0) { h *= h * 0.42f; br += h; bg += h; bb += h * 1.08f; }
    for (int i = 0; i < ndl; i++) {
        float e2 = vlen2(vsub(world, dl[i].p));
        if (e2 < dl[i].r2) {
            float k = 1.0f - sqrtf_(e2) * dl[i].inv;
            k *= k;
            br += dl[i].cr * k; bg += dl[i].cg * k; bb += dl[i].cb * k;
        }
    }
    float fog = (R_FAR - vz) * (1.0f / (R_FAR - 45.0f));
    if (fog > 1) fog = 1;
    if (fog < 0) fog = 0;
    o->r = minf(br * fog, 1); o->g = minf(bg * fog, 1); o->b = minf(bb * fog, 1); o->a = 1;
}

/* ---------------------------------------------------------------- clipping */
#define GB 1.9f   /* guard band: |x| <= GB*z (screen +-~320 px beyond the edge) */
static inline float plane_d(const rv_t *v, int p)
{
    switch (p) {
    case 0: return v->z - R_NEAR;
    case 1: return GB * v->z - v->x;
    case 2: return GB * v->z + v->x;
    case 3: return GB * v->z - v->y;
    default: return GB * v->z + v->y;
    }
}
static int clip_poly(rv_t *in, int n, rv_t *tmp)
{
    rv_t *a = in, *b = tmp;
    for (int p = 0; p < 5; p++) {
        int m = 0, all_in = 1;
        for (int i = 0; i < n; i++) if (plane_d(&a[i], p) < 0) { all_in = 0; break; }
        if (all_in) continue;
        for (int i = 0; i < n; i++) {
            rv_t *c = &a[i], *d = &a[(i + 1) % n];
            float dc = plane_d(c, p), dd = plane_d(d, p);
            if (dc >= 0) b[m++] = *c;
            if ((dc >= 0) != (dd >= 0)) {
                float t = dc / (dc - dd);
                rv_t *o = &b[m++];
                o->x = c->x + (d->x - c->x) * t; o->y = c->y + (d->y - c->y) * t; o->z = c->z + (d->z - c->z) * t;
                o->r = c->r + (d->r - c->r) * t; o->g = c->g + (d->g - c->g) * t; o->b = c->b + (d->b - c->b) * t;
                o->a = c->a + (d->a - c->a) * t;
                o->s = c->s + (d->s - c->s) * t; o->t = c->t + (d->t - c->t) * t;
            }
        }
        n = m;
        if (n < 3) return 0;
        rv_t *sw = a; a = b; b = sw;
    }
    if (a != in) for (int i = 0; i < n; i++) in[i] = a[i];
    return n;
}

static void project(const rv_t *v, float *o)
{
    float iz = 1.0f / v->z;
    o[0] = SCR_W * 0.5f + v->x * R_FOCAL * iz;
    o[1] = SCR_H * 0.5f - v->y * R_FOCAL * iz;
    float z = (1.0f / R_NEAR - iz) * (1.0f / (1.0f / R_NEAR - 1.0f / R_FAR));
    o[2] = z < 0 ? 0 : z > 0.9999f ? 0.9999f : z;
    o[3] = v->r; o[4] = v->g; o[5] = v->b; o[6] = v->a;
    o[7] = v->s; o[8] = v->t; o[9] = iz;
}

/* Emit a convex polygon (view-space verts). */
static void emit_poly(const rv_t *src, int n, int flags)
{
    rv_t pv[12], tmp[12];
    for (int i = 0; i < n; i++) pv[i] = src[i];
    n = clip_poly(pv, n, tmp);
    if (n < 3) return;
    float P[12][10];
    for (int i = 0; i < n; i++) project(&pv[i], P[i]);
    for (int i = 1; i < n - 1; i++) rdp_triangle(flags, P[0], P[i], P[i + 1]);
}

/* ---------------------------------------------------------------- visibility */
static void portal_rect(const cell_t *c, int d, const s16 *parent, s16 *out)
{
    static const float ax[6][2][3] = {
        {{0,1,0},{0,0,1}}, {{0,1,0},{0,0,1}}, {{1,0,0},{0,0,1}}, {{1,0,0},{0,0,1}}, {{1,0,0},{0,1,0}}, {{1,0,0},{0,1,0}},
    };
    vec3 a = v3(ax[d][0][0] * 6.6f, ax[d][0][1] * 6.6f, ax[d][0][2] * 6.6f);
    vec3 b = v3(ax[d][1][0] * 6.6f, ax[d][1][1] * 6.6f, ax[d][1][2] * 6.6f);
    float x0 = 1e9f, y0 = 1e9f, x1 = -1e9f, y1 = -1e9f;
    for (int k = 0; k < 4; k++) {
        vec3 p = vadd(c->fc[d], vadd(vmul(a, (k & 1) ? 1 : -1), vmul(b, (k & 2) ? 1 : -1)));
        vec3 v = to_view(p);
        if (v.z < R_NEAR) { out[0] = parent[0]; out[1] = parent[1]; out[2] = parent[2]; out[3] = parent[3]; return; }
        float iz = R_FOCAL / v.z;
        float sx = SCR_W * 0.5f + v.x * iz, sy = SCR_H * 0.5f - v.y * iz;
        if (sx < x0) x0 = sx; if (sx > x1) x1 = sx;
        if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
    }
    int ix0 = (int)x0 - 1, iy0 = (int)y0 - 1, ix1 = (int)x1 + 2, iy1 = (int)y1 + 2;
    out[0] = (s16)(ix0 > parent[0] ? ix0 : parent[0]);
    out[1] = (s16)(iy0 > parent[1] ? iy0 : parent[1]);
    out[2] = (s16)(ix1 < parent[2] ? ix1 : parent[2]);
    out[3] = (s16)(iy1 < parent[3] ? iy1 : parent[3]);
}

static int passable_view(const cell_t *c, int d)
{
    if (c->ftype[d] == F_OPEN) return 1;
    if (c->ftype[d] == F_DOOR) return L.doors[c->door[d]].t > 0.02f;
    return 0;
}

static void traverse(void)
{
    stamp++;
    nvis = 0;
    if (cam_cell_i < 0) return;
    cell_t *s = &L.cells[cam_cell_i];
    s->stamp = stamp; s->rx0 = 0; s->ry0 = 0; s->rx1 = SCR_W; s->ry1 = SCR_H;
    vis[nvis++] = cam_cell_i;
    for (int qi = 0; qi < nvis; qi++) {
        cell_t *c = &L.cells[vis[qi]];
        c->seen = 1;
        for (int d = 0; d < 6; d++) {
            if (!passable_view(c, d)) continue;
            int ni = c->nbr[d];
            cell_t *n = &L.cells[ni];
            /* camera must be on this cell's side of the portal */
            if (vdot(vsub(cam, c->fc[d]), c->fn[d]) < -0.5f) continue;
            if (vlen2(vsub(n->center, cam)) > (R_FAR + 12) * (R_FAR + 12)) continue;
            s16 rc[4];
            portal_rect(c, d, &c->rx0, rc);
            if (rc[0] >= rc[2] || rc[1] >= rc[3]) continue;
            if (n->stamp == stamp) {
                if (rc[0] < n->rx0) n->rx0 = rc[0];
                if (rc[1] < n->ry0) n->ry0 = rc[1];
                if (rc[2] > n->rx1) n->rx1 = rc[2];
                if (rc[3] > n->ry1) n->ry1 = rc[3];
                continue;
            }
            if (nvis >= MAXVIS) continue;
            n->stamp = stamp;
            n->rx0 = rc[0]; n->ry0 = rc[1]; n->rx1 = rc[2]; n->ry1 = rc[3];
            vis[nvis++] = ni;
        }
    }
}

int r_visible_cell(int c) { return c >= 0 && L.cells[c].stamp == stamp; }

/* ---------------------------------------------------------------- frame */
void r_begin(vec3 campos, const basis_t *b, int cam_cell, float time)
{
    cam = campos; cb = *b; cam_cell_i = cam_cell; rtime = time;
    ndl = 0; mode = -1; cur_tex = -1;
    rdp_begin();
    u16 *fb = fb_buf[fb_back];
    rdp_set_scissor(0, 0, SCR_W, SCR_H);
    rdp_set_other_modes(SOM_CYCLE_FILL);
    rdp_set_color_image(zbuf, SCR_W);
    rdp_set_fill_color(0xFFFCFFFC);
    rdp_fill_rect(0, 0, SCR_W - 1, SCR_H - 1);
    rdp_sync_pipe();
    rdp_set_color_image(fb, SCR_W);
    rdp_set_fill_color(0x00010001);
    rdp_fill_rect(0, 0, SCR_W - 1, SCR_H - 1);
    rdp_set_z_image(zbuf);
}

static void draw_wall(const wall_t *w)
{
    static const float S[4] = { 0, 1, 1, 0 }, T[4] = { 0, 0, 1, 1 };
    rv_t pv[5];
    float scroll = 0;
    if (w->tex == TEX_LAVA) scroll = rtime * 0.08f;
    vec3 ctr = vmul(vadd(vadd(w->p[0], w->p[1]), vadd(w->p[2], w->p[3])), 0.25f);
    for (int k = 0; k < 4; k++) {
        vec3 v = to_view(w->p[k]);
        pv[k].x = v.x; pv[k].y = v.y; pv[k].z = v.z;
        float s = (w->flags & 2) ? 1 - S[k] : S[k];
        pv[k].s = (s + scroll) * 32.0f; pv[k].t = (1 - T[k]) * 32.0f;
        light_vertex(&pv[k], w->p[k], v.z, w->col[k][0] * (1 / 255.0f), w->col[k][1] * (1 / 255.0f), w->col[k][2] * (1 / 255.0f));
    }
    vec3 cv = to_view(ctr);
    /* close walls: 4-triangle fan around the centre so ceiling light panels and
       the headlight spot read correctly; distant walls: a plain quad */
    if (cv.z < 16.0f && cv.z > -12.0f) {
        rv_t c;
        c.x = cv.x; c.y = cv.y; c.z = cv.z;
        float s = 0.5f;
        c.s = (s + scroll) * 32.0f; c.t = 16.0f;
        light_vertex(&c, ctr, cv.z, w->col[4][0] * (1 / 255.0f), w->col[4][1] * (1 / 255.0f), w->col[4][2] * (1 / 255.0f));
        for (int k = 0; k < 4; k++) {
            rv_t tri[3] = { c, pv[k], pv[(k + 1) & 3] };
            emit_poly(tri, 3, TRI_SHADE | TRI_TEX | TRI_Z);
        }
    } else {
        emit_poly(pv, 4, TRI_SHADE | TRI_TEX | TRI_Z);
    }
}

static vec3 quad_at(const vec3 *p, float s, float t)
{
    vec3 a = vlerp(p[0], p[1], s), b = vlerp(p[3], p[2], s);
    return vlerp(a, b, t);
}

static void draw_door(const door_t *d)
{
    static const float tint[5][3] = { {1, 1, 1}, {1.25f, 0.35f, 0.3f}, {0.35f, 0.55f, 1.3f}, {1.25f, 1.05f, 0.3f}, {0.45f, 1.2f, 0.5f} };
    float o = d->t;
    for (int half = 0; half < 2; half++) {
        float g0 = half ? 0.5f + 0.5f * o : 0, g1 = half ? 1 : 0.5f * (1 - o);
        float s0 = half ? 0.5f : 0.5f * o, s1 = half ? 1 - 0.5f * o : 0.5f;
        if (g1 - g0 < 0.01f) continue;
        float gs[4] = { g0, g1, g1, g0 }, ts[4] = { 0, 0, 1, 1 }, ss[4] = { s0, s1, s1, s0 };
        rv_t pv[4];
        for (int k = 0; k < 4; k++) {
            vec3 w = quad_at(d->p, gs[k], ts[k]);
            vec3 v = to_view(w);
            pv[k].x = v.x; pv[k].y = v.y; pv[k].z = v.z;
            pv[k].s = (d->flip ? 1 - ss[k] : ss[k]) * 32.0f; pv[k].t = (1 - ts[k]) * 32.0f;
            const float *tt = tint[d->type];
            light_vertex(&pv[k], w, v.z, d->light[0] * tt[0] * (1 / 255.0f), d->light[1] * tt[1] * (1 / 255.0f), d->light[2] * tt[2] * (1 / 255.0f));
        }
        emit_poly(pv, 4, TRI_SHADE | TRI_TEX | TRI_Z);
    }
}

void r_world(void)
{
    traverse();
    for (int t = 0; t < TEX_COUNT; t++) nbucket[t] = 0;
    r_walls_drawn = 0;
    for (int i = 0; i < nvis; i++) {
        cell_t *c = &L.cells[vis[i]];
        for (int k = 0; k < c->nwall; k++) {
            int wi = c->wall0 + k;
            wall_t *w = &L.walls[wi];
            if (vdot(vsub(cam, w->p[0]), w->n) <= 0.01f && vdot(vsub(cam, w->p[2]), w->n) <= 0.01f) continue;
            if (nbucket[w->tex] < 1200) bucket[w->tex][nbucket[w->tex]++] = (u16)wi;
        }
    }
    r_cells_drawn = nvis;
    set_mode(M_TEX);
    for (int t = 0; t < TEX_COUNT; t++) {
        if (!nbucket[t]) continue;
        bind_tex(t);
        for (int i = 0; i < nbucket[t]; i++) draw_wall(&L.walls[bucket[t][i]]);
        r_walls_drawn += nbucket[t];
    }
    bind_tex(TEX_DOOR);
    for (int i = 0; i < nvis; i++) {
        cell_t *c = &L.cells[vis[i]];
        for (int d = 0; d < 6; d++) {
            if (c->ftype[d] != F_DOOR) continue;
            door_t *dr = &L.doors[c->door[d]];
            if (dr->stamp == stamp || dr->t >= 0.999f) continue;
            dr->stamp = stamp;
            draw_door(dr);
        }
    }
}

/* ---------------------------------------------------------------- objects */
void r_mesh(const mesh_t *m, vec3 pos, const basis_t *b, float scale, const float *tint, float flash, float alpha)
{
    vec3 vv[40];
    vec3 wv[40];
    int nv = m->nv > 40 ? 40 : m->nv;
    vec3 c = to_view(pos);
    if (c.z < -6 * scale || c.z > R_FAR) return;
    if (absf(c.x) > c.z * 2.2f + 6 * scale || absf(c.y) > c.z * 1.7f + 6 * scale) return;
    for (int i = 0; i < nv; i++) {
        const float *p = m->v[i];
        vec3 w = vadd(pos, vmul(vadd(vadd(vmul(b->r, p[0]), vmul(b->u, p[1])), vmul(b->f, p[2])), scale));
        wv[i] = w;
        vv[i] = to_view(w);
    }
    set_mode(alpha < 0.99f ? M_SHADE_ALPHA : M_SHADE);
    vec3 ldir = vnorm(v3(0.35f, 0.8f, -0.45f));
    for (int i = 0; i < m->nt; i++) {
        const mtri_t *t = &m->t[i];
        vec3 a = wv[t->v[0]], bb = wv[t->v[1]], cc = wv[t->v[2]];
        vec3 n = vcross(vsub(bb, a), vsub(cc, a));
        if (vdot(n, vsub(cam, a)) < 0) n = vmul(n, -1);    /* two-sided */
        n = vnorm(n);
        float lam = 0.45f + 0.55f * maxf(0, vdot(n, ldir)) + 0.25f * maxf(0, vdot(n, vnorm(vsub(cam, a))));
        const u8 *pc = m->pal[t->col];
        float br = pc[0] * (1 / 255.0f), bg = pc[1] * (1 / 255.0f), bl = pc[2] * (1 / 255.0f);
        int emissive = t->col >= 8;   /* palette entries 8+ glow (eyes, lights) */
        if (!emissive) { br *= lam; bg *= lam; bl *= lam; }
        br *= tint[0]; bg *= tint[1]; bl *= tint[2];
        br += flash; bg += flash; bl += flash;
        rv_t pv[3];
        for (int k = 0; k < 3; k++) {
            vec3 v = vv[t->v[k]];
            pv[k].x = v.x; pv[k].y = v.y; pv[k].z = v.z; pv[k].s = pv[k].t = 0;
            float fog = clampf((R_FAR - v.z) * (1.0f / (R_FAR - 45.0f)), 0, 1);
            pv[k].r = minf(br * fog, 1); pv[k].g = minf(bg * fog, 1); pv[k].b = minf(bl * fog, 1); pv[k].a = alpha;
        }
        emit_poly(pv, 3, TRI_SHADE | TRI_Z);
    }
}

/* Soft additive disc facing the camera. */
void r_glow(vec3 pos, float radius, float r, float g, float b, float a)
{
    vec3 c = to_view(pos);
    if (c.z < R_NEAR + radius * 0.3f || c.z > R_FAR) return;
    float fog = clampf((R_FAR - c.z) * (1.0f / (R_FAR - 45.0f)), 0, 1);
    a *= fog;
    set_mode(M_ADD);
    rv_t ctr = { c.x, c.y, c.z - radius * 0.3f, r, g, b, a, 0, 0 };
    rv_t rim[8];
    for (int i = 0; i < 8; i++) {
        float ang = i * (PI_F / 4);
        rim[i] = ctr;
        rim[i].x = c.x + cosf_(ang) * radius; rim[i].y = c.y + sinf_(ang) * radius; rim[i].z = c.z;
        rim[i].a = 0;
    }
    for (int i = 0; i < 8; i++) {
        rv_t tri[3] = { ctr, rim[i], rim[(i + 1) & 7] };
        emit_poly(tri, 3, TRI_SHADE | TRI_Z);
    }
}

/* Camera-facing ribbon from a to b (projectile trails). */
void r_streak(vec3 a, vec3 b, float width, float r, float g, float bl)
{
    vec3 va = to_view(a), vb = to_view(b);
    if (va.z < R_NEAR && vb.z < R_NEAR) return;
    float dx = vb.x - va.x, dy = vb.y - va.y;
    float l = sqrtf_(dx * dx + dy * dy);
    if (l < 1e-4f) { dx = 1; dy = 0; l = 1; }
    float nx = -dy / l * width, ny = dx / l * width;
    set_mode(M_ADD);
    rv_t pv[4] = {
        { va.x + nx, va.y + ny, va.z, r, g, bl, 0.2f, 0, 0 },
        { vb.x + nx, vb.y + ny, vb.z, r, g, bl, 1, 0, 0 },
        { vb.x - nx, vb.y - ny, vb.z, r, g, bl, 1, 0, 0 },
        { va.x - nx, va.y - ny, va.z, r, g, bl, 0.2f, 0, 0 },
    };
    emit_poly(pv, 4, TRI_SHADE | TRI_Z);
}

void r_tint(int x0, int y0, int x1, int y1, u8 r, u8 g, u8 b, u8 a)
{
    set_mode(M_TINT);
    rdp_set_prim_color(((u32)r << 24) | ((u32)g << 16) | ((u32)b << 8) | a);
    rdp_rect(x0, y0, x1, y1);
}


int r_project(vec3 p, float *sx, float *sy, float *depth)
{
    vec3 v = to_view(p);
    if (v.z < R_NEAR) return 0;
    *sx = SCR_W * 0.5f + v.x * R_FOCAL / v.z;
    *sy = SCR_H * 0.5f - v.y * R_FOCAL / v.z;
    if (depth) *depth = v.z;
    return 1;
}

/* ---------------------------------------------------------------- automap */
/* Every seen cell's walls, untextured, coloured by region and dimmed when the
   cell was only seen (not visited); doors in their key colours. Orbit camera. */
void r_automap(float zoom, float yaw, float pitch, vec3 center, int player_cell)
{
    basis_t b;
    b.f = v3(-sinf_(yaw) * cosf_(pitch), sinf_(pitch), -cosf_(yaw) * cosf_(pitch));
    b.u = v3(0, 1, 0);
    basis_orthonormalize(&b);
    cam = vsub(center, vmul(b.f, zoom));
    cb = b;
    set_mode(M_SHADE);
    for (int ci = 0; ci < L.ncells; ci++) {
        cell_t *c = &L.cells[ci];
        if (!c->seen) continue;
        vec3 vc = to_view(c->center);
        if (vc.z < -10 || vc.z > R_FAR + 60) continue;
        if (absf(vc.x) > vc.z * 2.1f + 12 || absf(vc.y) > vc.z * 1.6f + 12) continue;
        const region_t *rg = &L.regions[c->region];
        float k = c->visited ? 1.0f : 0.45f;
        if (ci == player_cell) k = 1.6f;
        for (int w = 0; w < c->nwall; w++) {
            const wall_t *wl = &L.walls[c->wall0 + w];
            if (vdot(vsub(cam, wl->p[0]), wl->n) <= 0) continue;   /* see into the cells */
            float shade = 0.55f + 0.45f * absf(wl->n.y);
            float r = (0.25f + rg->light[0] * (0.6f / 255)) * k * shade;
            float g = (0.25f + rg->light[1] * (0.6f / 255)) * k * shade;
            float bl = (0.30f + rg->light[2] * (0.6f / 255)) * k * shade;
            if (wl->flags & 1) { r = 0.9f * k; g = 0.35f * k; bl = 0.1f * k; }
            rv_t pv[4];
            for (int q = 0; q < 4; q++) {
                vec3 v = to_view(wl->p[q]);
                pv[q].x = v.x; pv[q].y = v.y; pv[q].z = v.z; pv[q].s = pv[q].t = 0;
                float fog = clampf((R_FAR + 60 - v.z) / 80.0f, 0.25f, 1);
                pv[q].r = minf(r * fog, 1); pv[q].g = minf(g * fog, 1); pv[q].b = minf(bl * fog, 1); pv[q].a = 1;
            }
            emit_poly(pv, 4, TRI_SHADE | TRI_Z);
        }
    }
    static const float dc[5][3] = { {0.6f, 0.6f, 0.7f}, {1, 0.2f, 0.15f}, {0.2f, 0.4f, 1}, {1, 0.85f, 0.1f}, {0.2f, 1, 0.3f} };
    for (int i = 0; i < L.ndoors; i++) {
        const door_t *d = &L.doors[i];
        if (!L.cells[d->a].seen && !L.cells[d->b].seen) continue;
        if (d->state == 2) continue;
        rv_t pv[4];
        for (int q = 0; q < 4; q++) {
            vec3 v = to_view(vadd(vmul(d->p[q], 0.9f), vmul(d->c, 0.1f)));
            pv[q].x = v.x; pv[q].y = v.y; pv[q].z = v.z; pv[q].s = pv[q].t = 0;
            pv[q].r = dc[d->type][0]; pv[q].g = dc[d->type][1]; pv[q].b = dc[d->type][2]; pv[q].a = 1;
        }
        emit_poly(pv, 4, TRI_SHADE | TRI_Z);
        rv_t rv[4] = { pv[3], pv[2], pv[1], pv[0] };
        emit_poly(rv, 4, TRI_SHADE | TRI_Z);
    }
}

/* ---------------------------------------------------------------- HUD text */
static void text_mode(u32 rgba)
{
    set_mode(M_TEXT);
    if (cur_tex != -2) { rdp_load_font(font_i4, 128, 32); cur_tex = -2; }
    rdp_set_prim_color(rgba);
}

static void glyphs(int x, int y, const char *s, int sc)
{
    float inv = 1.0f / sc;
    for (int i = 0; s[i]; i++) {
        int ch = s[i];
        if (ch >= 'a' && ch <= 'z') ch -= 32;
        if (ch < 32 || ch > 95) ch = '?';
        if (ch == ' ') continue;
        ch -= 32;
        float gx = x + i * 6 * sc;
        rdp_tex_rect(0, gx, y, gx + 6 * sc, y + 8 * sc, (ch & 15) * 8, (ch >> 4) * 8, inv, inv);
    }
}

void r_text(int x, int y, const char *s, u32 rgba, int sc)
{
    text_mode(0x000000B0);
    glyphs(x + sc, y + sc, s, sc);
    rdp_set_prim_color(rgba);
    glyphs(x, y, s, sc);
}

void r_text_c(int y, const char *s, u32 rgba, int sc) { r_text((SCR_W - strlen(s) * 6 * sc) / 2, y, s, rgba, sc); }

int r_wrapped(int x, int y, int cols, const char *s, u32 rgba)
{
    char line[64];
    int lines = 0;
    while (*s) {
        int len = 0, last = -1, n;
        while (s[len] && len < cols) { if (s[len] == ' ') last = len; len++; }
        if (s[len] && last > 0) len = last;
        for (n = 0; n < len && n < 63; n++) line[n] = s[n];
        line[n] = 0;
        r_text(x, y + lines * 10, line, rgba, 1);
        lines++;
        s += len;
        while (*s == ' ') s++;
    }
    return lines;
}

void r_end(void)
{
    rdp_end();
}

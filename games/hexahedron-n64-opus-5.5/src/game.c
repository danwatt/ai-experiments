/* Hexahedron 64: game state, player, robots, weapons, pickups, doors, reactor,
 * escape countdown, automap and HUD. Ported (simplified) from the browser
 * version's game.js: three robot types and three weapons. */
#include "hw.h"
#include "video.h"
#include "rdp.h"
#include "pad.h"
#include "level.h"
#include "render.h"
#include "models.h"
#include "audio.h"
#include "game.h"

/* ---------------------------------------------------------------- tuning */
#define THRUST 72.0f
#define DRAG 2.4f
#define PLAYER_R 1.6f
#define COUNTDOWN 50.0f
enum { ST_TITLE, ST_BRIEF, ST_PLAY, ST_MAP, ST_PAUSE, ST_DEAD, ST_WON };
enum { W_LASER, W_SPREAD };
enum { E_DRONE, E_LEECH, E_BRUTE };
enum { P_SHIELD, P_SPREAD, P_MISSILES, P_KEY_BLUE, P_KEY_YELLOW, P_KEY_RED };
enum { K_LASER, K_SPREAD, K_MISSILE, K_BOLT, K_PLASMA };

typedef struct { float hp, r, speed, prefer, cd0, cd1, range, lead, drop; int shot, melee; float scale; } etype_t;
static const etype_t ET[3] = {
    /* drone */ { 30, 1.8f, 15, 22, 1.5f, 2.5f, 85, 0.5f, 0.25f, K_BOLT, 0, 1.0f },
    /* leech */ { 22, 1.5f, 22, 0, 0, 0, 0, 0, 0.25f, -1, 8, 0.85f },
    /* brute */ { 120, 2.7f, 6.5f, 28, 2.6f, 3.6f, 95, 0, 0.6f, K_PLASMA, 0, 1.0f },
};
typedef struct { float speed, dmg, rad, life, homing, splash; float r, g, b; float width, len; } pk_t;
static const pk_t PK[5] = {
    /* laser   */ { 140, 10, 0.3f, 1.6f, 0, 0, 0.35f, 0.72f, 1.0f, 0.22f, 2.4f },
    /* spread  */ { 120, 9, 0.35f, 1.6f, 0, 0, 0.5f, 1.0f, 0.35f, 0.25f, 1.8f },
    /* missile */ { 62, 60, 0.5f, 4, 3.2f, 10, 1.0f, 0.85f, 0.6f, 0.3f, 1.4f },
    /* bolt    */ { 62, 4, 0.4f, 2.5f, 0, 0, 1.0f, 0.23f, 0.1f, 0.25f, 1.8f },
    /* plasma  */ { 30, 10, 0.9f, 5, 0.9f, 0, 0.75f, 0.31f, 1.0f, 0.9f, 0.9f },
};

typedef struct {
    vec3 pos, vel; basis_t b;
    float shield; int has_spread, weapon, missiles; int keys[3];
    float fire_cd, missile_cd, hurt, heat, pick, roll, sizzle; int gun;
    int cell, dead; float dead_t;
    float turn_x, turn_y;
} player_t;

typedef struct {
    int type, big, alive, awake, los; float hp, maxhp, r, scale;
    vec3 pos, home, vel, side; basis_t b;
    float think, fire_cd, melee_cd, lost_t, hit_t, phase, freq;
    vec3 last_seen; int cell; float amb[3];
} enemy_t;

typedef struct { int kind, from, alive; vec3 pos, prev, vel; float life; int target; } proj_t;
typedef struct { int type, alive, cell; vec3 pos; float bob; } pickup_t;
typedef struct { vec3 pos; float t, life, size, r, g, b; } fx_t;

#define MAXE 120
#define MAXP 96
#define MAXPK 48
#define MAXFX 48
static player_t pl;
static enemy_t en[MAXE]; static int nen;
static proj_t pj[MAXP];
static pickup_t pk[MAXPK]; static int npk;
static fx_t fx[MAXFX];
static struct { int alive; float hp, maxhp, cd, burst_t; int burst; vec3 pos; int cell; float hit_t; int los; float think; } reactor;

static int state = ST_TITLE, mission = 0, loaded = -1;
static float game_t, countdown = -1, state_t, msg_t, obj_t, flow_t, alarm_t;
static char msg[64];
static const char *objective = "";
static int kills, total_enemies, god;
static u32 heap0;
static float map_yaw, map_pitch = 0.6f, map_zoom = 90;
static float title_yaw;

static void message(const char *s, float t)
{
    int i = 0;
    for (; s[i] && i < 63; i++) msg[i] = s[i];
    msg[i] = 0;
    msg_t = t;
}
static void set_objective(int k) { objective = L.obj[k]; if (!objective[0]) objective = L.obj[0]; obj_t = 7; }

/* ---------------------------------------------------------------- setup */
static void spawn_pickup(int type, vec3 pos)
{
    for (int i = 0; i < MAXPK; i++) if (!pk[i].alive) {
        pk[i].type = type; pk[i].alive = 1; pk[i].pos = pos; pk[i].bob = frand(0, 6.28f);
        pk[i].cell = level_find_cell(pos, -1);
        if (i >= npk) npk = i + 1;
        return;
    }
}

/* yaw angle of a direction (inverse of basis_yaw), by a short search */
static float atan_yaw(vec3 f)
{
    float best = 0, bd = -2;
    for (int i = 0; i < 64; i++) {
        float y = i * (PI_F / 32);
        float d = -sinf_(y) * f.x - cosf_(y) * f.z;
        if (d > bd) { bd = d; best = y; }
    }
    return best;
}

static void basis_yaw(basis_t *b, float yaw)
{
    b->f = v3(-sinf_(yaw), 0, -cosf_(yaw));
    b->u = v3(0, 1, 0);
    basis_orthonormalize(b);
}

static void load_mission(int m)
{
    if (loaded == m) return;
    if (!heap0) heap0 = heap_mark();
    heap_reset(heap0);
    level_load(m);
    loaded = m;
}

static void start_mission(void)
{
    /* reload so doors, seen flags and pickups reset */
    loaded = -1;
    load_mission(mission);
    memset(&pl, 0, sizeof pl);
    pl.pos = L.start;
    basis_yaw(&pl.b, L.yaw);
    pl.shield = 100;
    pl.cell = level_find_cell(pl.pos, -1);
    pl.gun = 1;
    nen = 0;
    for (int i = 0; i < L.nenemies && nen < MAXE; i++) {
        enemy_t *e = &en[nen++];
        memset(e, 0, sizeof *e);
        e->type = L.enemies[i].type; e->big = L.enemies[i].big;
        const etype_t *T = &ET[e->type];
        e->alive = 1;
        e->hp = e->maxhp = T->hp * (e->big ? 3.5f : 1);
        e->r = T->r * (e->big ? 1.35f : 1);
        e->scale = T->scale * (e->big ? 1.35f : 1);
        e->pos = e->home = L.enemies[i].pos;
        basis_yaw(&e->b, frand(0, 6.28f));
        e->think = frand(0, 0.3f); e->fire_cd = frand(0.5f, 1.5f);
        e->phase = frand(0, 6.28f); e->freq = frand(0.6f, 1.2f);
        e->side = vnorm(v3(frand(-1, 1), frand(-1, 1), frand(-1, 1)));
        e->cell = level_find_cell(e->pos, -1);
        e->lost_t = 99;
        for (int k = 0; k < 3; k++) e->amb[k] = 1;
    }
    total_enemies = nen;
    memset(pk, 0, sizeof pk); npk = 0;
    for (int i = 0; i < L.npickups; i++) spawn_pickup(L.pickups[i].type, L.pickups[i].pos);
    for (int k = 0; k < 3; k++) if (L.has_key[k]) spawn_pickup(P_KEY_BLUE + k, L.key[k]);
    memset(pj, 0, sizeof pj);
    memset(fx, 0, sizeof fx);
    reactor.alive = L.has_reactor;
    reactor.hp = reactor.maxhp = mission == 2 ? 700 : 320;
    reactor.pos = L.reactor; reactor.cd = 2; reactor.burst = 0;
    reactor.cell = level_find_cell(reactor.pos, -1);
    game_t = 0; countdown = -1; kills = 0; msg_t = 0; flow_t = 0;
#ifdef GOD
    god = 1;   /* screenshot / test builds */
#endif
    set_objective(0);
    message(L.name, 3);
}

/* ---------------------------------------------------------------- effects */
static void effect(vec3 pos, float size, float life, float r, float g, float b)
{
    int best = 0;
    for (int i = 0; i < MAXFX; i++) { if (fx[i].t >= fx[i].life) { best = i; break; } if (fx[i].t / fx[i].life > fx[best].t / fx[best].life) best = i; }
    fx[best].pos = pos; fx[best].t = 0; fx[best].life = life; fx[best].size = size; fx[best].r = r; fx[best].g = g; fx[best].b = b;
}
static void explode(vec3 pos, float size, float r, float g, float b)
{
    effect(pos, size * 5, 0.55f + size * 0.15f, r, g, b);
    effect(pos, size * 2.8f, 0.3f, 1, 0.95f, 0.8f);
    for (int i = 0; i < 4; i++) effect(vadd(pos, v3(frand(-1, 1) * size * 2, frand(-1, 1) * size * 2, frand(-1, 1) * size * 2)), size * 2, 0.4f + frand(0, 0.3f), r, g * 0.8f, b * 0.6f);
}

/* ---------------------------------------------------------------- damage */
static int last_dmg_src;
static void damage_player(float amount, int silent)
{
    last_dmg_src = silent ? 9 : (int)amount;
    if (god) return;
    if (pl.dead || state != ST_PLAY) return;
    pl.shield -= amount;
    pl.hurt = minf(0.8f, pl.hurt + amount / 22);
    if (!silent) sfx(SFX_HURT);
    if (pl.shield < 0) {
        pl.shield = 0; pl.dead = 1; pl.dead_t = 0;
        explode(vmad(pl.pos, pl.b.f, 3), 3, 1, 0.6f, 0.25f);
        sfx(SFX_BIGBOOM);
        message("SHIP DESTROYED", 5);
    }
}

static void kill_enemy(enemy_t *e)
{
    e->alive = 0;
    kills++;
    explode(e->pos, e->type == E_BRUTE ? 2 : 1.1f, e->type == E_BRUTE ? 0.8f : 1, e->type == E_BRUTE ? 0.45f : 0.55f, e->type == E_BRUTE ? 1 : 0.2f);
    sfx(SFX_BOOM);
    if (frand(0, 1) < (e->big ? 1.0f : ET[e->type].drop)) spawn_pickup(P_SHIELD, e->pos);
    if (e->big) spawn_pickup(P_MISSILES, vadd(e->pos, v3(0, 2, 0)));
}

static void damage_enemy(enemy_t *e, float d)
{
    if (!e->alive) return;
    e->hp -= d; e->hit_t = 0.12f; e->awake = 1; e->lost_t = 0; e->last_seen = pl.pos;
    if (e->hp <= 0) kill_enemy(e);
}

static void damage_reactor(float d)
{
    if (!reactor.alive) return;
    reactor.hp -= d; reactor.hit_t = 0.12f;
    if (reactor.hp <= 0) {
        reactor.alive = 0;
        for (int i = 0; i < 4; i++) explode(vadd(reactor.pos, v3(frand(-3, 3), frand(-3, 3), frand(-3, 3))), 3, 1, 0.4f, 0.9f);
        sfx(SFX_BIGBOOM);
        countdown = COUNTDOWN;
        message(mission == 2 ? "OVERSEER CORE DESTROYED! ESCAPE!" : "REACTOR DESTROYED! ESCAPE!", 4);
        set_objective(4);
    }
}

/* ---------------------------------------------------------------- doors */
static const char *const KEYNAME[3] = { "BLUE", "YELLOW", "RED" };
static void try_open_door(int di, int by_player)
{
    door_t *d = &L.doors[di];
    if (d->state != 0) return;
    const char *locked = 0;
    static char buf[40];
    if (d->type >= DOOR_RED && d->type <= DOOR_YELLOW) {
        int k = d->type == DOOR_BLUE ? 0 : d->type == DOOR_YELLOW ? 1 : 2;
        if (!pl.keys[k]) {
            int n = 0; const char *kn = KEYNAME[k];
            while (*kn) buf[n++] = *kn++;
            const char *t = " KEY REQUIRED"; while (*t) buf[n++] = *t++;
            buf[n] = 0; locked = buf;
        }
    } else if (d->type == DOOR_EXIT && reactor.alive) {
        locked = mission == 2 ? "EXIT SEALED - DESTROY THE OVERSEER CORE" : "EXIT SEALED - DESTROY THE REACTOR";
    } else if (d->oneway) {
        int side_a = vdot(vsub(pl.pos, d->c), d->n) > 0;
        if (!side_a) locked = "THIS DOOR OPENS FROM THE OTHER SIDE";
    }
    if (locked) {
        if (by_player && d->warn <= 0) { message(locked, 2); sfx(SFX_LOCKED); d->warn = 2.5f; }
        return;
    }
    d->state = 1;
    sfx(SFX_DOOR);
    if (d->type >= DOOR_RED && d->type <= DOOR_YELLOW) {
        int k = d->type == DOOR_BLUE ? 0 : d->type == DOOR_YELLOW ? 1 : 2;
        int n = 0; const char *kn = KEYNAME[k];
        while (*kn) buf[n++] = *kn++;
        const char *t = " DOOR UNLOCKED"; while (*t) buf[n++] = *t++;
        buf[n] = 0;
        message(buf, 2);
    }
}

static void update_doors(float dt)
{
    for (int i = 0; i < L.ndoors; i++) {
        door_t *d = &L.doors[i];
        d->warn -= dt;
        if (d->state == 0) {
            if (vlen2(vsub(d->c, pl.pos)) < 100) {
                float r = PLAYER_R + 1.6f;
                const ctri_t *t = &L.tris[2 * (L.nwalls + i)];
                if (dist2_tri(pl.pos, t) < r * r || dist2_tri(pl.pos, t + 1) < r * r) try_open_door(i, 1);
            }
        } else if (d->state == 1) {
            d->t += dt * 1.5f;
            if (d->t >= 1) { d->t = 1; d->state = 2; }
        }
    }
}

static int passable(const cell_t *c, int d)
{
    if (c->ftype[d] == F_OPEN) return 1;
    if (c->ftype[d] == F_DOOR) return L.doors[c->door[d]].t >= 0.55f;
    return 0;
}

/* BFS distance from the player's cell, for robots that lost sight of the ship */
static s16 queue[3000];
static void update_flow(void)
{
    for (int i = 0; i < L.ncells; i++) L.cells[i].flow = -1;
    if (pl.cell < 0) return;
    int qh = 0, qt = 0;
    queue[qt++] = (s16)pl.cell; L.cells[pl.cell].flow = 0;
    while (qh < qt) {
        cell_t *c = &L.cells[queue[qh++]];
        if (c->flow >= 30) continue;
        for (int d = 0; d < 6; d++) {
            if (!passable(c, d)) continue;
            cell_t *n = &L.cells[c->nbr[d]];
            if (n->flow >= 0) continue;
            n->flow = c->flow + 1;
            if (qt < 3000) queue[qt++] = c->nbr[d];
        }
    }
}

/* ---------------------------------------------------------------- weapons */
static void spawn_proj(int kind, int from, vec3 origin, vec3 dir, int target)
{
    for (int i = 0; i < MAXP; i++) if (!pj[i].alive) {
        proj_t *p = &pj[i];
        p->kind = kind; p->from = from; p->alive = 1;
        p->pos = origin; p->prev = from == 0 ? pl.pos : origin;
        p->vel = vmul(vnorm(dir), PK[kind].speed);
        if (from == 0) p->vel = vmad(p->vel, pl.vel, 0.5f);
        p->life = PK[kind].life; p->target = target;
        return;
    }
}

static vec3 muzzle(float x, float y) { return vadd(pl.pos, vadd(vadd(vmul(pl.b.r, x), vmul(pl.b.u, y)), vmul(pl.b.f, 1.2f))); }

static void fire_primary(void)
{
    if (pl.weapon == W_LASER) {
        spawn_proj(K_LASER, 0, muzzle(-0.9f, -0.5f), pl.b.f, -1);
        spawn_proj(K_LASER, 0, muzzle(0.9f, -0.5f), pl.b.f, -1);
        pl.fire_cd = 0.25f;
        sfx(SFX_LASER);
        r_light(muzzle(0, -0.5f), 26, 0.25f, 0.5f, 0.8f);
    } else {
        static int axis;
        vec3 ax = axis ? pl.b.u : pl.b.r;
        axis ^= 1;
        for (int k = -1; k <= 1; k++) spawn_proj(K_SPREAD, 0, muzzle(0, -0.5f), vmad(pl.b.f, ax, k * 0.075f), -1);
        pl.fire_cd = 0.3f;
        sfx(SFX_SPREAD);
        r_light(muzzle(0, -0.5f), 26, 0.3f, 0.7f, 0.25f);
    }
}

static void fire_missile(void)
{
    if (pl.missiles <= 0) { message("NO MISSILES", 1); sfx(SFX_EMPTY); pl.missile_cd = 0.5f; return; }
    /* lock the robot nearest the crosshair */
    int best = -1; float bd = 0.86f;
    for (int i = 0; i < nen; i++) {
        enemy_t *e = &en[i];
        if (!e->alive) continue;
        vec3 to = vsub(e->pos, pl.pos);
        float d = vlen(to);
        if (d > 120) continue;
        float c = vdot(to, pl.b.f) / d;
        if (c > bd && raycast(pl.pos, e->pos, 0) > 1) { bd = c; best = i; }
    }
    if (reactor.alive) {
        vec3 to = vsub(reactor.pos, pl.pos);
        float d = vlen(to);
        if (d < 120 && vdot(to, pl.b.f) / d > bd) best = 1000;
    }
    pl.gun = -pl.gun;
    spawn_proj(K_MISSILE, 0, muzzle(pl.gun * 0.6f, -0.8f), pl.b.f, best);
    pl.missiles--;
    pl.missile_cd = 0.6f;
    sfx(SFX_MISSILE);
}

static void splash(vec3 pos, float radius, float dmg)
{
    for (int i = 0; i < nen; i++) {
        enemy_t *e = &en[i];
        if (!e->alive) continue;
        float d = vlen(vsub(e->pos, pos));
        if (d < radius + e->r) damage_enemy(e, dmg * clampf(1 - d / (radius + e->r), 0.2f, 1));
    }
    if (reactor.alive && vlen(vsub(reactor.pos, pos)) < radius + 6) damage_reactor(dmg * 0.5f);
}

static void update_projectiles(float dt)
{
    for (int i = 0; i < MAXP; i++) {
        proj_t *p = &pj[i];
        if (!p->alive) continue;
        const pk_t *K = &PK[p->kind];
        p->life -= dt;
        if (p->life <= 0) { p->alive = 0; continue; }
        if (K->homing > 0) {
            vec3 tgt; int ok = 0;
            if (p->from == 1) { tgt = pl.pos; ok = !pl.dead; }
            else if (p->target == 1000 && reactor.alive) { tgt = reactor.pos; ok = 1; }
            else if (p->target >= 0 && p->target < nen && en[p->target].alive) { tgt = en[p->target].pos; ok = 1; }
            if (ok) {
                vec3 want = vmul(vnorm(vsub(tgt, p->pos)), vlen(p->vel));
                p->vel = vlerp(p->vel, want, minf(1, dt * K->homing));
            }
        }
        if (p->kind == K_MISSILE) p->vel = vmul(p->vel, 1 + dt * 0.6f);
        p->prev = p->pos;
        vec3 np = vmad(p->pos, p->vel, dt);
        ctri_t *tri = 0;
        float t = raycast(p->pos, np, &tri);
        int hit = 0;
        vec3 hp = np;
        if (t <= 1) { hit = 1; hp = vlerp(p->pos, np, t); }
        /* robots / reactor / player */
        if (p->from == 0) {
            for (int k = 0; k < nen && !(hit == 2); k++) {
                enemy_t *e = &en[k];
                if (!e->alive) continue;
                vec3 d = vsub(e->pos, np);
                float rr = e->r + K->rad;
                if (vlen2(d) < rr * rr) { damage_enemy(e, K->dmg); hit = 2; hp = np; sfx(SFX_HIT); }
            }
            if (!hit && reactor.alive && vlen2(vsub(reactor.pos, np)) < (4 + K->rad) * (4 + K->rad)) { damage_reactor(K->dmg); hit = 2; hp = np; sfx(SFX_HIT); }
        } else if (!pl.dead) {
            float rr = PLAYER_R + K->rad;
            if (vlen2(vsub(pl.pos, np)) < rr * rr) { damage_player(K->dmg, 0); hit = 2; hp = np; }
        }
        if (hit) {
            p->alive = 0;
            if (hit == 1 && tri && tri->door >= 0 && p->from == 0) try_open_door(tri->door, 1);
            if (K->splash > 0) { splash(hp, K->splash, K->dmg); explode(hp, 1.2f, 1, 0.7f, 0.3f); sfx(SFX_BOOM); }
            else { effect(hp, 1.6f + K->rad * 2, 0.25f, K->r, K->g, K->b); if (hit == 1 && p->from == 0) sfx(SFX_WALL); }
            continue;
        }
        p->pos = np;
    }
}

/* ---------------------------------------------------------------- robots */
static void enemy_shoot(enemy_t *e, int kind, float dist)
{
    vec3 origin = vmad(e->pos, e->b.f, e->r + 0.4f);
    vec3 aim = vsub(vmad(pl.pos, pl.vel, dist / PK[kind].speed * ET[e->type].lead), origin);
    aim = vadd(aim, vmul(v3(frand(-1, 1), frand(-1, 1), frand(-1, 1)), dist * 0.05f));   /* a little scatter */
    spawn_proj(kind, 1, origin, aim, -1);
    sfx(kind == K_PLASMA ? SFX_PLASMA : SFX_ESHOT);
}

static void update_enemy(enemy_t *e, float dt)
{
    const etype_t *T = &ET[e->type];
    vec3 to = vsub(pl.pos, e->pos);
    float dist = vlen(to);
    if (dist > 160 && !e->awake) return;
    e->think -= dt;
    if (e->think <= 0) {
        e->think = frand(0.15f, 0.3f);
        e->cell = level_find_cell(e->pos, e->cell);
        e->los = !pl.dead && dist < 110 && raycast(e->pos, pl.pos, 0) > 1;
        if (e->los) {
            if (!e->awake) { e->awake = 1; e->fire_cd = frand(0.4f, 1.2f); }
            e->last_seen = pl.pos; e->lost_t = 0;
        }
        if (e->cell >= 0) {
            const region_t *rg = &L.regions[L.cells[e->cell].region];
            for (int k = 0; k < 3; k++) e->amb[k] = 0.55f + rg->amb[k] * (1.1f / 255);
        }
    }
    if (!e->los) e->lost_t += dt;
    if (e->lost_t > 14) e->awake = 0;
    vec3 dir = vmul(to, 1.0f / (dist > 0.01f ? dist : 1));
    float tt = game_t * e->freq + e->phase;
    vec3 des;
    if (e->awake && e->los) {
        if (e->type == E_LEECH) {
            if (e->melee_cd > 0.4f) des = vmul(dir, -T->speed * 0.6f);
            else des = vadd(vmul(dir, T->speed), vmul(vnorm(vcross(dir, e->side)), sinf_(tt * 4) * 6));
        } else {
            float radial = clampf((dist - T->prefer) / 10, -1, 1);
            des = vmul(dir, radial * T->speed);
            des = vadd(des, vmul(vnorm(vcross(dir, e->side)), sinf_(tt) * T->speed * 0.7f));
        }
    } else if (e->awake) {
        vec3 target = e->last_seen;
        if (e->cell >= 0) {
            cell_t *c = &L.cells[e->cell];
            int best = -1, bf = c->flow >= 0 ? c->flow : 999;
            for (int d = 0; d < 6; d++) {
                if (!passable(c, d)) continue;
                int f = L.cells[c->nbr[d]].flow;
                if (f >= 0 && f < bf) { bf = f; best = c->nbr[d]; }
            }
            if (best >= 0) target = L.cells[best].center;
        }
        des = vsub(target, e->pos);
        if (vlen2(des) > 1) des = vmul(vnorm(des), T->speed * 0.85f);
    } else {
        /* idle: bob in place without collision work */
        e->pos.y = e->home.y + sinf_(tt * 1.5f) * 0.25f;
        e->vel = v3(0, 0, 0);
        e->hit_t -= dt;
        return;
    }
    e->vel = vlerp(e->vel, des, 1 - expf_(-dt * 2.5f));
    e->pos = vmad(e->pos, e->vel, dt);
    collide_t cr;
    collide_sphere(&e->pos, &e->vel, e->r, 0.3f, &cr);
    /* keep off the player */
    float md = e->r + PLAYER_R;
    if (dist < md && dist > 0.01f) { e->pos = vmad(e->pos, dir, -(md - dist)); }

    /* facing */
    vec3 look = e->los ? dir : (vlen2(e->vel) > 1 ? e->vel : e->b.f);
    basis_turn_towards(&e->b, look, dt * (e->type == E_BRUTE ? 1.8f : e->type == E_LEECH ? 6 : 4));
    if (e->type == E_LEECH) basis_rotate(&e->b, 0, 0, dt * 3);

    /* attack */
    if (T->shot >= 0 && e->awake && e->los && !pl.dead) {
        e->fire_cd -= dt;
        if (e->fire_cd <= 0 && dist < T->range && vdot(e->b.f, dir) > 0.86f) {
            enemy_shoot(e, T->shot, dist);
            e->fire_cd = frand(T->cd0, T->cd1) * (e->big ? 0.6f : 1);
        }
    }
    if (T->melee) {
        e->melee_cd -= dt;
        if (dist < e->r + PLAYER_R + 0.5f && e->melee_cd <= 0 && !pl.dead) {
            damage_player(T->melee, 0);
            e->melee_cd = 1.0f;
            pl.vel = vmad(pl.vel, dir, 14);
        }
    }
    e->hit_t -= dt;
}

static void separate_enemies(void)
{
    for (int i = 0; i < nen; i++) {
        enemy_t *a = &en[i];
        if (!a->alive || !a->awake) continue;
        for (int j = i + 1; j < nen; j++) {
            enemy_t *b = &en[j];
            if (!b->alive) continue;
            vec3 d = vsub(a->pos, b->pos);
            float m = a->r + b->r, l2 = vlen2(d);
            if (l2 < m * m && l2 > 1e-4f) {
                float l = sqrtf_(l2), push = (m - l) * 0.5f;
                d = vmul(d, 1 / l);
                a->pos = vmad(a->pos, d, push); b->pos = vmad(b->pos, d, -push);
            }
        }
    }
}

static void update_reactor(float dt)
{
    if (!reactor.alive) return;
    reactor.hit_t -= dt;
    reactor.think -= dt;
    float dist = vlen(vsub(pl.pos, reactor.pos));
    if (reactor.think <= 0) {
        reactor.think = 0.3f;
        reactor.los = !pl.dead && dist < 95 && raycast(vmad(reactor.pos, vnorm(vsub(pl.pos, reactor.pos)), 5), pl.pos, 0) > 1;
    }
    if (!reactor.los) return;
    reactor.cd -= dt;
    if (reactor.burst > 0) {
        reactor.burst_t -= dt;
        if (reactor.burst_t <= 0) {
            vec3 dir = vnorm(vsub(pl.pos, reactor.pos));
            vec3 o = vmad(reactor.pos, dir, 5);
            spawn_proj(reactor.burst & 1 ? K_BOLT : K_PLASMA, 1, o, vsub(vmad(pl.pos, pl.vel, dist / 62 * 0.4f), o), -1);
            sfx(SFX_ESHOT);
            reactor.burst--; reactor.burst_t = 0.18f;
        }
    } else if (reactor.cd <= 0) {
        reactor.burst = mission == 2 ? 5 : 3;
        reactor.cd = frand(1.8f, 2.6f);
    }
}

/* ---------------------------------------------------------------- pickups */
static void update_pickups(float dt)
{
    for (int i = 0; i < npk; i++) {
        pickup_t *p = &pk[i];
        if (!p->alive) continue;
        p->bob += dt * 2;
        float r = p->type >= P_KEY_BLUE ? 3.2f : 2.8f;
        if (pl.dead || vlen2(vsub(p->pos, pl.pos)) > r * r) continue;
        switch (p->type) {
        case P_SHIELD:
            if (pl.shield >= 200) continue;
            pl.shield = minf(200, pl.shield + 25);
            message("SHIELD BOOSTED", 1.5f); sfx(SFX_PICKUP);
            break;
        case P_SPREAD:
            if (!pl.has_spread) { pl.has_spread = 1; pl.weapon = W_SPREAD; message("SPREADFIRE CANNON!", 2.5f); }
            else { pl.shield = minf(200, pl.shield + 10); message("SPREADFIRE ALREADY INSTALLED", 1.5f); }
            sfx(SFX_WEAPON);
            break;
        case P_MISSILES:
            pl.missiles += 4; message("4 HOMING MISSILES", 2); sfx(SFX_WEAPON);
            break;
        default: {
            int k = p->type - P_KEY_BLUE;
            pl.keys[k] = 1;
            static char buf[24]; int n = 0; const char *kn = KEYNAME[k];
            while (*kn) buf[n++] = *kn++;
            const char *t = " KEY ACQUIRED!"; while (*t) buf[n++] = *t++;
            buf[n] = 0;
            message(buf, 3); sfx(SFX_KEY);
            set_objective(k + 1);
            break; }
        }
        p->alive = 0;
        pl.pick = 0.5f;
    }
}

/* ---------------------------------------------------------------- player */
static void update_player(float dt)
{
    if (pl.dead) { pl.dead_t += dt; return; }
    /* stick: smoothed turn rates so a digital (keyboard) stick still feels analogue */
    float sx = pad.sx / 80.0f, sy = pad.sy / 80.0f;
    sx = clampf(sx, -1, 1); sy = clampf(sy, -1, 1);
    if (absf(sx) < 0.12f) sx = 0;
    if (absf(sy) < 0.12f) sy = 0;
    float k = minf(1, dt * 9);
    pl.turn_x += (sx - pl.turn_x) * k;
    pl.turn_y += (sy - pl.turn_y) * k;
    float roll_in = ((pad.held & BTN_DL) ? 1.0f : 0) - ((pad.held & BTN_DR) ? 1.0f : 0);
    pl.roll += (roll_in * 2.3f - pl.roll) * minf(1, dt * 7);
    /* flight-style: stick up / up arrow pushes the nose down */
    basis_rotate(&pl.b, -pl.turn_y * 1.7f * dt, -pl.turn_x * 1.9f * dt, pl.roll * dt);
    basis_orthonormalize(&pl.b);

    vec3 acc = v3(0, 0, 0);
    if (pad.held & BTN_A) acc = vadd(acc, pl.b.f);
    if (pad.held & BTN_B) acc = vsub(acc, pl.b.f);
    if (pad.held & BTN_CR) acc = vadd(acc, pl.b.r);
    if (pad.held & BTN_CL) acc = vsub(acc, pl.b.r);
    if (pad.held & BTN_CU) acc = vadd(acc, pl.b.u);
    if (pad.held & BTN_CD) acc = vsub(acc, pl.b.u);
    if (vlen2(acc) > 0) acc = vmul(vnorm(acc), THRUST);
    pl.vel = vmul(vmad(pl.vel, acc, dt), expf_(-DRAG * dt));

    int steps = (int)(vlen(pl.vel) * dt / 0.6f) + 1;
    int lava = 0;
    for (int i = 0; i < steps; i++) {
        pl.pos = vmad(pl.pos, pl.vel, dt / steps);
        collide_t cr;
        collide_sphere(&pl.pos, &pl.vel, PLAYER_R, 0.2f, &cr);
        if (cr.lava) lava = 1;
        if (cr.door >= 0) try_open_door(cr.door, 1);
    }
    if (reactor.alive) {
        vec3 d = vsub(pl.pos, reactor.pos);
        float rd = vlen(d), rmin = 6.2f + PLAYER_R;
        if (rd < rmin && rd > 0.01f) {
            vec3 n = vmul(d, 1 / rd);
            pl.pos = vmad(pl.pos, n, rmin - rd);
            float vn = vdot(pl.vel, n);
            if (vn < 0) pl.vel = vmad(pl.vel, n, -vn * 1.3f);
        }
    }
    if (lava) {
        damage_player(30 * dt, 1);
        pl.vel.y += 30 * dt;
        pl.heat = minf(1, pl.heat + dt * 4);
        pl.sizzle -= dt;
        if (pl.sizzle <= 0) { sfx(SFX_SIZZLE); pl.sizzle = 0.3f; message("HULL BURNING - GET OFF THE LAVA!", 1); }
    }
    int oc = pl.cell;
    pl.cell = level_find_cell(pl.pos, pl.cell);
    if (pl.cell >= 0) {
        L.cells[pl.cell].visited = 1;
        if (pl.cell != oc) flow_t = 0;
        if (countdown >= 0) for (int i = 0; i < L.nexit; i++) if (L.exits[i] == pl.cell) { state = ST_WON; state_t = 0; sfx(SFX_START); }
    }

    pl.fire_cd -= dt; pl.missile_cd -= dt;
    if ((pad.held & BTN_Z) && pl.fire_cd <= 0) fire_primary();
    if ((pad.held & BTN_R) && pl.missile_cd <= 0) fire_missile();
#if defined(DEBUG_HUD) || defined(WARP)
    /* debug: hold L and press D-down to warp: keys -> reactor -> exit */
    if ((pad.held & BTN_L) && (pad.pressed & BTN_DD)) {
        static int w;
        god = 1;
        vec3 to = pl.pos;
        int k = w % 5;
        if (k < 3) { if (L.has_key[k]) to = L.key[k]; }
        else if (k == 3) { if (L.has_reactor) to = vadd(L.reactor, v3(0, 0, 12)); for (int i = 0; i < 3; i++) pl.keys[i] = 1; }
        else to = L.cells[L.exits[0]].center;
        w++;
        pl.pos = vadd(to, v3(0, 1.5f, 0)); pl.vel = v3(0, 0, 0);
        if (k == 3 && L.has_reactor) { pl.b.f = vnorm(vsub(L.reactor, pl.pos)); pl.b.u = v3(0, 1, 0); basis_orthonormalize(&pl.b); }
        pl.cell = level_find_cell(pl.pos, -1);
        return;
    }
#endif
    if ((pad.pressed & BTN_L) && !(pad.held & BTN_DD)) {
        if (pl.has_spread) { pl.weapon ^= 1; message(pl.weapon ? "SPREADFIRE" : "LASER", 1); sfx(SFX_MENU); }
        else { message("NO OTHER WEAPON YET", 1); sfx(SFX_EMPTY); }
    }
}

/* ---------------------------------------------------------------- frame */
static void world_frame(float dt)
{
    game_t += dt;
    update_player(dt);
    update_doors(dt);
    flow_t -= dt;
    if (flow_t <= 0) { update_flow(); flow_t = 0.5f; }
    for (int i = 0; i < nen; i++) if (en[i].alive) update_enemy(&en[i], dt);
    separate_enemies();
    update_reactor(dt);
    update_projectiles(dt);
    update_pickups(dt);
    for (int i = 0; i < MAXFX; i++) fx[i].t += dt;
    pl.hurt = maxf(0, pl.hurt - dt * 1.5f);
    pl.heat = maxf(0, pl.heat - dt * 2);
    pl.pick = maxf(0, pl.pick - dt * 2);
    msg_t -= dt; obj_t -= dt;
    if (countdown >= 0) {
        float before = countdown;
        countdown -= dt;
        alarm_t -= dt;
        if (alarm_t <= 0) { sfx(SFX_ALARM); alarm_t = countdown < 15 ? 0.5f : 1.0f; }
        if ((int)before != (int)countdown && countdown < 10) message("SELF-DESTRUCT IMMINENT", 1);
        if (countdown <= 0 && !pl.dead) {
            countdown = 0;
            pl.shield = 0; pl.dead = 1; pl.dead_t = 0;
            explode(vmad(pl.pos, pl.b.f, 4), 4, 1, 0.8f, 0.5f);
            sfx(SFX_BIGBOOM);
            message("THE MINE EXPLODED WITH YOU INSIDE", 5);
        }
    }
    if (pl.dead && pl.dead_t > 1.6f && state == ST_PLAY) { state = ST_DEAD; state_t = 0; }
}

static const float key_col[3][3] = { {0.25f, 0.5f, 1.0f}, {1.0f, 0.82f, 0.15f}, {1.0f, 0.22f, 0.12f} };

static void draw_scene(vec3 cam, const basis_t *b, int cell, int show_player_fx)
{
    /* dynamic lights first: they affect the walls */
    for (int i = 0; i < MAXP; i++) if (pj[i].alive) {
        const pk_t *K = &PK[pj[i].kind];
        if (pj[i].kind == K_MISSILE || pj[i].kind == K_PLASMA) r_light(pj[i].pos, 18, K->r * 0.5f, K->g * 0.5f, K->b * 0.5f);
    }
    for (int i = 0; i < MAXFX; i++) if (fx[i].t < fx[i].life && fx[i].size > 4) {
        float k = 1 - fx[i].t / fx[i].life;
        r_light(fx[i].pos, fx[i].size * 4, fx[i].r * k, fx[i].g * k, fx[i].b * k);
    }
    if (reactor.alive) r_light(reactor.pos, 40, 0.5f, 0.15f, 0.4f);
    r_begin(cam, b, cell, game_t);
    r_world();

    float one[3] = { 1, 1, 1 };
    for (int i = 0; i < nen; i++) {
        enemy_t *e = &en[i];
        if (!e->alive || !r_visible_cell(e->cell)) continue;
        const mesh_t *m = e->type == E_DRONE ? &mesh_drone : e->type == E_LEECH ? &mesh_leech : &mesh_brute;
        float tint[3] = { e->amb[0], e->amb[1], e->amb[2] };
        if (e->big) { tint[0] *= 1.25f; tint[1] *= 1.0f; tint[2] *= 0.7f; }
        r_mesh(m, e->pos, &e->b, e->scale, tint, e->hit_t > 0 ? 0.6f : 0, 1);
    }
    if (reactor.alive && r_visible_cell(reactor.cell)) {
        basis_t rb; basis_yaw(&rb, game_t * 0.7f);
        float pulse = 0.75f + 0.25f * sinf_(game_t * 5);
        float core[3] = { 1.0f * pulse, 0.3f * pulse, 0.8f * pulse };
        r_mesh(&mesh_oct, reactor.pos, &rb, 3.0f, core, reactor.hit_t > 0 ? 0.5f : 0, 1);
        basis_t cb2; basis_yaw(&cb2, -game_t * 0.4f);
        r_mesh(&mesh_cage, reactor.pos, &cb2, 5.6f, one, reactor.hit_t > 0 ? 0.3f : 0, 0.45f);
    }
    for (int i = 0; i < npk; i++) {
        pickup_t *p = &pk[i];
        if (!p->alive) continue;
        if (!r_visible_cell(p->cell)) continue;
        vec3 pos = vadd(p->pos, v3(0, sinf_(p->bob) * 0.4f + 0.8f, 0));
        basis_t pb; basis_yaw(&pb, p->bob);
        if (p->type == P_SHIELD) { float c[3] = { 0.35f, 0.6f, 1.0f }; r_mesh(&mesh_oct, pos, &pb, 0.9f, c, 0, 1); }
        else if (p->type == P_SPREAD) { float c[3] = { 0.4f, 1.0f, 0.35f }; r_mesh(&mesh_box, pos, &pb, 0.9f, c, 0, 1); }
        else if (p->type == P_MISSILES) { float c[3] = { 1.0f, 0.6f, 0.25f }; basis_t mb = pb; mb.f = vmul(mb.f, 2.2f); r_mesh(&mesh_box, pos, &mb, 0.5f, c, 0, 1); }
        else { const float *c = key_col[p->type - P_KEY_BLUE]; r_mesh(&mesh_oct, pos, &pb, 1.2f, c, 0, 1); }
    }
    /* additive: projectiles, glows, explosions */
    for (int i = 0; i < MAXP; i++) {
        proj_t *p = &pj[i];
        if (!p->alive) continue;
        const pk_t *K = &PK[p->kind];
        vec3 tail = vmad(p->pos, vnorm(p->vel), -K->len);
        r_streak(tail, p->pos, K->width, K->r, K->g, K->b);
        r_glow(p->pos, K->width * 4 + 0.6f, K->r, K->g, K->b, 0.7f);
    }
    for (int i = 0; i < npk; i++) {
        pickup_t *p = &pk[i];
        if (!p->alive || p->type < P_KEY_BLUE) continue;
        const float *c = key_col[p->type - P_KEY_BLUE];
        r_glow(vadd(p->pos, v3(0, sinf_(p->bob) * 0.4f + 0.8f, 0)), 3.2f, c[0], c[1], c[2], 0.6f);
    }
    if (reactor.alive) r_glow(reactor.pos, 9, 1, 0.3f, 0.8f, 0.5f);
    for (int i = 0; i < MAXFX; i++) {
        fx_t *f = &fx[i];
        if (f->t >= f->life) continue;
        float k = f->t / f->life;
        r_glow(f->pos, f->size * (0.4f + 0.6f * k), f->r, f->g, f->b, (1 - k) * 0.9f);
    }
    (void)show_player_fx;
}

static u32 rgba(float r, float g, float b, float a)
{
    int R = (int)(clampf(r, 0, 1) * 255), G = (int)(clampf(g, 0, 1) * 255), B = (int)(clampf(b, 0, 1) * 255), A = (int)(clampf(a, 0, 1) * 255);
    return ((u32)R << 24) | ((u32)G << 16) | ((u32)B << 8) | (u32)A;
}

static void draw_hud(void)
{
    char b[24];
    /* tints */
    if (pl.hurt > 0.01f) r_tint(0, 0, SCR_W, SCR_H, 255, 20, 10, (u8)(pl.hurt * 150));
    if (pl.heat > 0.01f) r_tint(0, SCR_H / 2, SCR_W, SCR_H, 255, 110, 0, (u8)(pl.heat * 90));
    if (pl.pick > 0.01f) r_tint(0, 0, SCR_W, SCR_H, 80, 150, 255, (u8)(pl.pick * 110));
    /* crosshair */
    r_tint(156, 119, 159, 121, 130, 210, 255, 200); r_tint(161, 119, 164, 121, 130, 210, 255, 200);
    r_tint(159, 114, 161, 117, 130, 210, 255, 200); r_tint(159, 123, 161, 126, 130, 210, 255, 200);
    /* shield */
    r_text(14, 200, "SHIELD", 0x9FD0FFC0, 1);
    fmt_int(b, (int)(pl.shield + 0.99f)); r_text(14, 210, b, pl.shield < 30 ? 0xFF6050FF : 0xFFFFFFFF, 2);
    r_tint(14, 228, 114, 232, 40, 60, 90, 160);
    r_tint(14, 228, 14 + (int)(clampf(pl.shield, 0, 200) / 2), 232, pl.shield < 30 ? 255 : 64, pl.shield < 30 ? 80 : 160, 255, 230);
    /* weapons */
    r_text(SCR_W - 14 - 6 * 10, 200, pl.weapon ? "SPREADFIRE" : "     LASER", pl.weapon ? 0x7DFF5AFF : 0x58B8FFFF, 1);
    {
        int n = 0; const char *t = "MISSILES "; while (*t) b[n++] = *t++;
        char num[8]; fmt_int(num, pl.missiles); for (int i = 0; num[i]; i++) b[n++] = num[i];
        b[n] = 0;
        r_text(SCR_W - 14 - 6 * n, 212, b, pl.missiles ? 0xFFC080FF : 0x806050FF, 1);
    }
    /* keys */
    for (int k = 0; k < 3; k++) if (pl.keys[k]) {
        const float *c = key_col[k];
        r_tint(14 + k * 22, 12, 32 + k * 22, 26, (u8)(c[0] * 255), (u8)(c[1] * 255), (u8)(c[2] * 255), 220);
        char s[2] = { KEYNAME[k][0], 0 };
        r_text(20 + k * 22, 15, s, 0x000000FF, 1);
    }
    /* room */
    if (pl.cell >= 0) {
        const char *rn = L.regions[L.cells[pl.cell].region].name;
        r_text(SCR_W - 12 - strlen(rn) * 6, 14, rn, 0xA0C8E8C0, 1);
    }
    /* countdown */
    if (countdown >= 0) {
        int s = (int)(countdown + 0.99f);
        fmt_int(b, s);
        r_text_c(30, b, ((int)(game_t * 4) & 1) ? 0xFF4030FF : 0xFFA090FF, 4);
    }
    if (msg_t > 0) r_text_c(70, msg, rgba(1, 1, 1, minf(1, msg_t * 2)), 1);
    else if (obj_t > 0) r_wrapped(30, 160, 43, objective, rgba(0.75f, 0.85f, 1, minf(1, obj_t)));
    /* robot locator: small marker on the nearest awake robot off-screen? keep it simple: kills */
}

/* ---------------------------------------------------------------- menus */
static const char *const MISSION_NAMES[3] = { "1  PROSPECT STATION", "2  HEXAHEDRON DEEP WORKS", "3  OVERSEER CITADEL" };

static void title_frame(float dt)
{
    title_yaw += dt * 0.25f;
    if (pad.pressed & (BTN_DU | BTN_CU)) { mission = (mission + 2) % 3; sfx(SFX_MENU); }
    if (pad.pressed & (BTN_DD | BTN_CD)) { mission = (mission + 1) % 3; sfx(SFX_MENU); }
    if (pad.sy > 50 && state_t > 0.25f) { mission = (mission + 2) % 3; sfx(SFX_MENU); state_t = 0; }
    if (pad.sy < -50 && state_t > 0.25f) { mission = (mission + 1) % 3; sfx(SFX_MENU); state_t = 0; }
    load_mission(mission);
    basis_t b; basis_yaw(&b, L.yaw + sinf_(title_yaw) * 1.2f);
    basis_rotate(&b, sinf_(title_yaw * 0.7f) * 0.25f, 0, 0);
    basis_orthonormalize(&b);
    int c = level_find_cell(L.start, -1);
    r_begin(L.start, &b, c, game_t);
    r_world();
    r_tint(0, 0, SCR_W, SCR_H, 0, 0, 12, 110);
    r_text_c(28, "HEXAHEDRON", 0xFFFFFFFF, 4);
    r_text_c(64, "6DOF MINE RUN FOR THE NINTENDO 64", 0x7AB0CCFF, 1);
    for (int i = 0; i < 3; i++) {
        int sel = i == mission;
        if (sel) r_tint(52, 92 + i * 16, SCR_W - 52, 105 + i * 16, 40, 90, 160, 150);
        r_text(64, 95 + i * 16, MISSION_NAMES[i], sel ? 0xFFFFFFFF : 0x8098B0FF, 1);
    }
    r_wrapped(30, 150, 43, L.text, 0xB8C8D8FF);
    if (((int)(game_t * 2)) & 1) r_text_c(222, "PRESS START", 0xFFFFFFFF, 1);
#ifdef DEBUG_HUD
    { static int fr; char b[12]; fmt_int(b, fr++); r_text(4, 4, b, 0xFFFF00FF, 1); fmt_int(b, (int)(dt * 1000)); r_text(60, 4, b, 0x00FFFFFF, 1);
      fmt_int(b, rdp_tris); r_text(100, 4, b, 0xFF80FFFF, 1); fmt_int(b, r_cells_drawn); r_text(140, 4, b, 0x80FF80FF, 1);
      { static const char hx[] = "0123456789ABCDEF"; char h[5]; for (int q = 0; q < 4; q++) h[q] = hx[(pad.held >> (12 - 4 * q)) & 15]; h[4] = 0; r_text(260, 4, h, 0xFFFFFFFF, 1); } }
#endif
    r_end();
    if (pad.pressed & (BTN_START | BTN_A)) { state = ST_BRIEF; state_t = 0; sfx(SFX_START); }
}

static void brief_frame(void)
{
    r_begin(L.start, &pl.b, -1, game_t);
    r_tint(0, 0, SCR_W, SCR_H, 0, 4, 16, 255);
    r_text_c(20, L.name, 0xFFFFFFFF, 2);
    r_wrapped(30, 46, 43, L.text, 0xB8C8D8FF);
    r_text(30, 106, "CONTROLS (N64 PAD / KEYBOARD)", 0x7AB0CCFF, 1);
    static const char *const lines[] = {
        "STICK / ARROWS    LOOK",
        "A,B / W,S         FORWARD, REVERSE",
        "C / A,D,R,F       SLIDE",
        "D-LEFT,RIGHT / Q,E  ROLL",
        "Z / SPACE         FIRE",
        "R / X             HOMING MISSILE",
        "L / C             SWITCH WEAPON",
        "D-UP / M          AUTOMAP",
        "START / ENTER     PAUSE",
    };
    for (int i = 0; i < 9; i++) r_text(30, 118 + i * 10, lines[i], 0xD0D8E0FF, 1);
    if (((int)(game_t * 2)) & 1) r_text_c(222, "PRESS START TO LAUNCH", 0xFFFFFFFF, 1);
    r_end();
    game_t += 1.0f / 30;
    if (state_t > 0.3f && (pad.pressed & (BTN_START | BTN_A))) { start_mission(); state = ST_PLAY; state_t = 0; sfx(SFX_DOOR); }
}

static void end_screen(int won)
{
    draw_scene(pl.pos, &pl.b, pl.cell, 0);
    r_tint(0, 0, SCR_W, SCR_H, won ? 0 : 40, 0, won ? 20 : 0, 150);
    char b[48], n[12];
    if (won) {
        r_text_c(50, "MINE CLEARED", 0x60FF80FF, 3);
        r_text_c(84, L.name, 0xFFFFFFFF, 1);
    } else {
        r_text_c(50, "GAME OVER", 0xFF5040FF, 3);
        r_text_c(84, msg, 0xFFFFFFFF, 1);
    }
    int k = 0; const char *t = "ROBOTS DESTROYED: "; while (*t) b[k++] = *t++;
    fmt_int(n, kills); for (int i = 0; n[i]; i++) b[k++] = n[i];
    b[k++] = '/'; fmt_int(n, total_enemies); for (int i = 0; n[i]; i++) b[k++] = n[i];
    b[k] = 0;
    r_text_c(110, b, 0xD0D8E0FF, 1);
    k = 0; t = "TIME: "; while (*t) b[k++] = *t++;
    int secs = (int)game_t;
    fmt_int(n, secs / 60); for (int i = 0; n[i]; i++) b[k++] = n[i];
    b[k++] = ':'; b[k++] = '0' + (secs % 60) / 10; b[k++] = '0' + secs % 10; b[k] = 0;
    r_text_c(124, b, 0xD0D8E0FF, 1);
    if (((int)(state_t * 2)) & 1) r_text_c(180, won ? "PRESS START" : "START: RETRY   B: MISSION SELECT", 0xFFFFFFFF, 1);
    r_end();
    if (state_t > 1.0f) {
        if (pad.pressed & BTN_START) {
            if (won) { state = ST_TITLE; mission = (mission + 1) % 3; loaded = -1; }
            else { start_mission(); state = ST_PLAY; }
            state_t = 0;
        } else if (!won && (pad.pressed & BTN_B)) { state = ST_TITLE; loaded = -1; state_t = 0; }
    }
}

static void map_frame(float dt)
{
    map_yaw -= pad.sx / 80.0f * dt * 1.8f;
    map_pitch = clampf(map_pitch + pad.sy / 80.0f * dt * 1.4f, -1.3f, 1.3f);
    if (pad.held & (BTN_A | BTN_CU)) map_zoom = maxf(25, map_zoom - dt * 60);
    if (pad.held & (BTN_B | BTN_CD)) map_zoom = minf(260, map_zoom + dt * 60);
    r_begin(pl.pos, &pl.b, -1, game_t);
    r_automap(map_zoom, map_yaw, map_pitch, pl.pos, pl.cell);
    /* ship marker */
    float sx, sy;
    if (r_project(pl.pos, &sx, &sy, 0)) { r_tint((int)sx - 3, (int)sy - 3, (int)sx + 3, (int)sy + 3, 255, 255, 255, 255); }
    if (reactor.alive) {
        int rc = reactor.cell;
        if (rc >= 0 && L.cells[rc].seen && r_project(reactor.pos, &sx, &sy, 0)) r_tint((int)sx - 3, (int)sy - 3, (int)sx + 3, (int)sy + 3, 255, 60, 200, 255);
    }
    r_text(12, 10, "AUTOMAP", 0xFFFFFFFF, 2);
    r_text(12, 30, "BRIGHT: VISITED   DIM: SEEN", 0xA0B0C0FF, 1);
    r_text(12, 40, "STICK: ROTATE   A/B: ZOOM", 0xA0B0C0FF, 1);
    r_text(12, 50, "D-UP: BACK", 0xA0B0C0FF, 1);
    r_wrapped(12, 196, 48, objective, 0xC0D0E0FF);
    r_end();
    if (state_t > 0.05f && (pad.pressed & (BTN_DU | BTN_START))) state = ST_PLAY;
}

static void pause_frame(void)
{
    draw_scene(pl.pos, &pl.b, pl.cell, 0);
    r_tint(0, 0, SCR_W, SCR_H, 0, 0, 10, 160);
    r_text_c(40, "PAUSED", 0xFFFFFFFF, 3);
    r_text_c(74, L.name, 0x7AB0CCFF, 1);
    r_wrapped(30, 94, 43, objective, 0xD0D8E0FF);
    r_text_c(160, "START: RESUME", 0xFFFFFFFF, 1);
    r_text_c(174, "Z: ABANDON MISSION", 0xC0A0A0FF, 1);
    r_end();
    if (state_t > 0.05f && (pad.pressed & BTN_START)) state = ST_PLAY;
    if (state_t > 0.05f && (pad.pressed & BTN_Z)) { state = ST_TITLE; loaded = -1; state_t = 0; }
}

void game_frame(float dt)
{
    state_t += dt;
    switch (state) {
    case ST_TITLE: game_t += dt; title_frame(dt); break;
    case ST_BRIEF: brief_frame(); break;
    case ST_PLAY:
        if (pad.pressed & BTN_START) { state = ST_PAUSE; state_t = 0; sfx(SFX_MENU); pause_frame(); break; }
        if (pad.pressed & BTN_DU) { state = ST_MAP; state_t = 0; map_yaw = atan_yaw(pl.b.f); map_frame(0); break; }
        {
        u32 t0 = c0_count();
        world_frame(dt);
        u32 t1 = c0_count();
        draw_scene(pl.pos, &pl.b, pl.cell, 1);
        draw_hud();
        u32 t2 = c0_count();
#ifdef DEBUG_HUD
        { static u32 tu, td, tw; char b[12];
          fmt_int(b, (int)(dt * 1000)); r_text(100, 4, b, 0xFFFF00FF, 1);
          fmt_int(b, (int)(tu / 46875)); r_text(130, 4, b, 0xFF8080FF, 1);
          fmt_int(b, (int)(td / 46875)); r_text(160, 4, b, 0x80FF80FF, 1);
          fmt_int(b, (int)(tw / 46875)); r_text(190, 4, b, 0x8080FFFF, 1);
          fmt_int(b, rdp_tris); r_text(220, 4, b, 0x00FFFFFF, 1);
          { int nl = 0, ns = 0; for (int i = 0; i < nen; i++) if (en[i].alive && en[i].los) nl++;
            for (int i = 0; i < MAXP; i++) if (pj[i].alive && pj[i].from == 1) ns++;
            fmt_int(b, nl); r_text(4, 20, b, 0xFF4040FF, 1); fmt_int(b, ns); r_text(30, 20, b, 0xFFA040FF, 1);
            fmt_int(b, last_dmg_src); r_text(56, 20, b, 0xFFFFFFFF, 1);
            fmt_int(b, (int)(game_t * 10)); r_text(80, 20, b, 0x80FFFFFF, 1); }
          tu = t1 - t0; td = t2 - t1;
          u32 t3 = c0_count(); r_end(); tw = c0_count() - t3; }
#else
        (void)t0; (void)t1; (void)t2;
        r_end();
#endif
        }
        break;
    case ST_MAP: map_frame(dt); break;
    case ST_PAUSE: pause_frame(); break;
    case ST_DEAD: end_screen(0); break;
    case ST_WON: end_screen(1); break;
    }
}

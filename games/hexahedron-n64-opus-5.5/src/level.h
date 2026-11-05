#ifndef LEVEL_H
#define LEVEL_H
#include "mathx.h"

#define CELL_S 10.0f
enum { F_WALL = 0, F_OPEN = 1, F_DOOR = 2 };
enum { DOOR_NORMAL, DOOR_RED, DOOR_BLUE, DOOR_YELLOW, DOOR_EXIT };
enum { TEX_METAL, TEX_TECH, TEX_FLOOR, TEX_GRATE, TEX_PANEL, TEX_HAZARD, TEX_PIPES, TEX_ROCK, TEX_LAVAROCK, TEX_LAVA, TEX_CRYSTAL, TEX_LIGHT, TEX_DOOR, TEX_COUNT };

typedef struct {
    s16 x, y, z;
    u16 region;
    s16 nbr[6];
    s16 door[6];
    u8 ftype[6];
    u8 seen, visited;
    vec3 center;
    vec3 fc[6], fn[6];          /* face centroids and inward normals (for inside tests) */
    u16 wall0, nwall;
    int stamp;                  /* render traversal stamp */
    s16 rx0, ry0, rx1, ry1;     /* portal clip rect for the current frame */
    s16 flow;                   /* BFS distance from the player (robot pathing) */
} cell_t;

typedef struct {
    u8 tex, flags;              /* flags: 1 lava, 2 flipped u */
    u16 cell;
    vec3 p[4];
    vec3 n;
    u8 col[5][3];               /* lit vertex colours: 4 corners + centre */
} wall_t;

typedef struct {
    u16 a, b;
    u8 dir, type, oneway, flip;
    vec3 p[4], n, c;
    u8 light[3];
    u8 state;                   /* 0 closed, 1 opening, 2 open */
    float t, warn;
    int stamp;
} door_t;

typedef struct {
    char name[28];
    u8 sector, lava;
    u8 light[3], amb[3];
} region_t;

typedef struct {
    vec3 a, e1, e2, n;
    s16 door;                   /* -1 for walls */
    u8 lava;
    int stamp;
} ctri_t;

typedef struct { u8 type, big; vec3 pos; } spawn_t;

typedef struct {
    char name[40], text[400], obj[5][160], reactor_name[24];
    int ncells, nwalls, ndoors, nregions, nenemies, npickups;
    cell_t *cells;
    wall_t *walls;
    door_t *doors;
    region_t *regions;
    ctri_t *tris;               /* 2 per wall, then 2 per door */
    spawn_t *enemies, *pickups;
    vec3 start; float yaw;
    int has_reactor; vec3 reactor;
    int has_key[3]; vec3 key[3];  /* blue, yellow, red */
    int nexit; u16 exits[4];
    int gx, gy, gz, dx, dy, dz;
    s16 *cellgrid;
    u32 *slot;
    u16 *ids;
} level_t;

extern level_t L;
void level_load(int mission);
int level_find_cell(vec3 p, int hint);
int level_cell_at(int x, int y, int z);

typedef struct { int hit, lava, door; } collide_t;
void collide_sphere(vec3 *pos, vec3 *vel, float r, float bounce, collide_t *res);
/* Segment test against walls and closed doors: returns t in [0,1] or 2 for no hit. *tri gets the triangle. */
float raycast(vec3 p0, vec3 p1, ctri_t **tri);
float dist2_tri(vec3 p, const ctri_t *t);
#endif

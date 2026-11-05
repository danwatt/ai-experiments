#ifndef RENDER_H
#define RENDER_H
#include "mathx.h"

#define R_NEAR 0.6f
#define R_FAR 120.0f
#define R_FOCAL 170.0f

/* Mesh: triangles with per-triangle colours, model space (z forward, y up, x right). */
typedef struct { s8 v[3]; u8 col; } mtri_t;
typedef struct {
    int nv, nt;
    const float (*v)[3];
    const mtri_t *t;
    const u8 (*pal)[3];
} mesh_t;

void r_begin(vec3 campos, const basis_t *b, int cam_cell, float time);
void r_world(void);
void r_automap(float zoom, float yaw, float pitch, vec3 center, int player_cell);
void r_mesh(const mesh_t *m, vec3 pos, const basis_t *b, float scale, const float *tint, float flash, float alpha);
void r_glow(vec3 pos, float radius, float r, float g, float b, float a);
void r_streak(vec3 a, vec3 b, float width, float r, float g, float bl);
void r_tint(int x0, int y0, int x1, int y1, u8 r, u8 g, u8 b, u8 a);
void r_light(vec3 pos, float radius, float r, float g, float b);
int r_project(vec3 p, float *sx, float *sy, float *depth);
void r_text(int x, int y, const char *s, u32 rgba, int sc);
void r_text_c(int y, const char *s, u32 rgba, int sc);
int r_wrapped(int x, int y, int cols, const char *s, u32 rgba);
void r_end(void);
int r_visible_cell(int c);
extern int r_cells_drawn, r_walls_drawn;
#endif

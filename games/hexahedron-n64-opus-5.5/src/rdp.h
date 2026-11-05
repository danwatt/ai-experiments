#ifndef RDP_H
#define RDP_H
#include "hw.h"

#define TRI_Z 1
#define TRI_TEX 2
#define TRI_SHADE 4

/* Other-modes bits (see libdragon rdpq_macros.h) */
#define SOM_CYCLE_1      (0ULL << 52)
#define SOM_CYCLE_FILL   (3ULL << 52)
#define SOM_PERSP        (1ULL << 51)
#define SOM_SAMPLE_POINT (0ULL << 44)
#define SOM_SAMPLE_BILIN (2ULL << 44)
#define SOM_TF_RGB       ((1ULL << 43) | (2ULL << 41))
#define SOM_DITHER_SQ    (0ULL << 38)
#define SOM_DITHER_NONE  (3ULL << 38)
#define SOM_ADITHER_NONE (3ULL << 36)
#define SOM_BLENDING     (1ULL << 14)
#define SOM_Z_WRITE      (1ULL << 5)
#define SOM_Z_COMPARE    (1ULL << 4)
#define SOM_ZMODE_TRANSP (2ULL << 10)
#define BLEND_OPAQUE     0x0f0a0000ULL                 /* (IN, 0, IN, 1) */
#define BLEND_ALPHA      (0x00500040ULL | SOM_BLENDING) /* (IN, IN_A, MEM, 1-A) */
#define BLEND_ADD        (0x005a0040ULL | SOM_BLENDING) /* (IN, IN_A, MEM, 1) */

#define CC_TEX_SHADE 0x001218248833ffffULL
#define CC_SHADE     0x00887f1088fe793cULL
#define CC_PRIM      0x00887f1088fdf6fbULL
#define CC_TEXT      0x00881710882dfeffULL   /* rgb = PRIM, a = TEX0 * PRIM_A */

void rdp_begin(void);
void rdp_end(void);
void rdp_sync_pipe(void);
void rdp_sync_load(void);
void rdp_sync_tile(void);
void rdp_set_color_image(const void *fb, int width);
void rdp_set_z_image(const void *z);
void rdp_set_scissor(int x0, int y0, int x1, int y1);
void rdp_set_other_modes(u64 som);
void rdp_set_combine(u64 cc);
void rdp_set_fill_color(u32 c);
void rdp_set_prim_color(u32 rgba);
void rdp_set_env_color(u32 rgba);
void rdp_set_blend_color(u32 rgba);
void rdp_fill_rect(int x0, int y0, int x1, int y1);
void rdp_rect(int x0, int y0, int x1, int y1);
void rdp_load_texture32(const u16 *tex);
void rdp_triangle(int flags, const float *v1, const float *v2, const float *v3);
extern int rdp_tris, rdp_timeouts, rdp_dropped;
void rdp_load_font(const u8 *i4, int w, int h);
void rdp_tex_rect(int tile, float x0, float y0, float x1, float y1, float s, float t, float dsdx, float dtdy);
#endif

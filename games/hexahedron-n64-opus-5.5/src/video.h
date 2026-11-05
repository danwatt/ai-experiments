#ifndef VIDEO_H
#define VIDEO_H
#include "hw.h"

#define SCR_W 320
#define SCR_H 240
#define RGB16(r, g, b) ((u16)((((r) >> 3) << 11) | (((g) >> 3) << 6) | (((b) >> 3) << 1) | 1))

extern u16 *const fb_buf[3];
extern u8 font_i4[128 * 32 / 2];
extern const u8 font5x7[64][5];
void font_init(void);
extern u16 *const zbuf;
extern int fb_back;

void video_init(void);
void video_vsync(void);
void video_swap(void);
void fill_rect(u16 *fb, int x, int y, int w, int h, u16 c);
void shade_rect(u16 *fb, int x, int y, int w, int h);
void draw_text(u16 *fb, int x, int y, const char *s, u16 c, int scale);
void draw_text_c(u16 *fb, int y, const char *s, u16 c, int scale);
int draw_wrapped(u16 *fb, int x, int y, int cols, const char *s, u16 c);
int text_width(const char *s, int scale);
void fmt_int(char *out, int v);
void halt(void);
void crash(u32 cause, u32 epc, u32 bad);
#endif

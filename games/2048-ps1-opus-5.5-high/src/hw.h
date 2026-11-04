/* PlayStation hardware registers and basic types (no SDK). */
#ifndef HW_H
#define HW_H

typedef unsigned int   u32;
typedef unsigned short u16;
typedef unsigned char  u8;
typedef signed int     s32;
typedef signed short   s16;
typedef signed char    s8;

#define REG32(a) (*(volatile u32 *)(a))
#define REG16(a) (*(volatile u16 *)(a))
#define REG8(a)  (*(volatile u8 *)(a))

/* Interrupt controller */
#define I_STAT   REG32(0x1F801070)
#define I_MASK   REG32(0x1F801074)
#define IRQ_VBLANK 0
#define IRQ_SIO0   7

/* DMA */
#define DPCR     REG32(0x1F8010F0)
#define DICR     REG32(0x1F8010F4)
#define D2_MADR  REG32(0x1F8010A0)
#define D2_BCR   REG32(0x1F8010A4)
#define D2_CHCR  REG32(0x1F8010A8)

/* GPU */
#define GP0      REG32(0x1F801810)
#define GP1      REG32(0x1F801814)
#define GPUSTAT  REG32(0x1F801814)

/* Controller port serial interface */
#define SIO_DATA REG8(0x1F801040)
#define SIO_STAT REG16(0x1F801044)
#define SIO_MODE REG16(0x1F801048)
#define SIO_CTRL REG16(0x1F80104A)
#define SIO_BAUD REG16(0x1F80104E)

/* SPU */
#define SPU_VOICE(v, r)  REG16(0x1F801C00 + (v) * 16 + (r))
#define SPU_MAIN_VOL_L   REG16(0x1F801D80)
#define SPU_MAIN_VOL_R   REG16(0x1F801D82)
#define SPU_REVERB_VOL_L REG16(0x1F801D84)
#define SPU_REVERB_VOL_R REG16(0x1F801D86)
#define SPU_KEY_ON_LO    REG16(0x1F801D88)
#define SPU_KEY_ON_HI    REG16(0x1F801D8A)
#define SPU_KEY_OFF_LO   REG16(0x1F801D8C)
#define SPU_KEY_OFF_HI   REG16(0x1F801D8E)
#define SPU_FM_LO        REG16(0x1F801D90)
#define SPU_FM_HI        REG16(0x1F801D92)
#define SPU_NOISE_LO     REG16(0x1F801D94)
#define SPU_NOISE_HI     REG16(0x1F801D96)
#define SPU_REVERB_LO    REG16(0x1F801D98)
#define SPU_REVERB_HI    REG16(0x1F801D9A)
#define SPU_ADDR         REG16(0x1F801DA6)
#define SPU_FIFO         REG16(0x1F801DA8)
#define SPU_CTRL         REG16(0x1F801DAA)
#define SPU_XFER_CTRL    REG16(0x1F801DAC)
#define SPU_STAT         REG16(0x1F801DAE)
#define SPU_CD_VOL_L     REG16(0x1F801DB0)
#define SPU_CD_VOL_R     REG16(0x1F801DB2)
#define SPU_EXT_VOL_L    REG16(0x1F801DB4)
#define SPU_EXT_VOL_R    REG16(0x1F801DB6)

/* Pad buttons (active-high after pad_read) */
#define PAD_SELECT   (1 << 0)
#define PAD_START    (1 << 3)
#define PAD_UP       (1 << 4)
#define PAD_RIGHT    (1 << 5)
#define PAD_DOWN     (1 << 6)
#define PAD_LEFT     (1 << 7)
#define PAD_L2       (1 << 8)
#define PAD_R2       (1 << 9)
#define PAD_L1       (1 << 10)
#define PAD_R1       (1 << 11)
#define PAD_TRIANGLE (1 << 12)
#define PAD_CIRCLE   (1 << 13)
#define PAD_CROSS    (1 << 14)
#define PAD_SQUARE   (1 << 15)

/* Colours are written as 0xRRGGBB in the source; the GPU wants 0xBBGGRR. */
#define BGR(c) ((((c) >> 16) & 0xFF) | ((c) & 0xFF00) | (((c) & 0xFF) << 16))

void *memset(void *d, int c, unsigned n);
void *memcpy(void *d, const void *s, unsigned n);

/* gpu.c */
void gpu_init(void);
void gpu_begin(u32 clear_rgb);
void gpu_end(void);
void vsync(void);
void fill_rect(int x, int y, int w, int h, u32 rgb);
void rect(int x, int y, int w, int h, u32 rgb, int semi);
void quad_g(const s16 *xy, const u32 *rgb, int semi);
void tri_f(int x0, int y0, int x1, int y1, int x2, int y2, u32 rgb, int semi);
void hex(int cx, int cy, int r, u32 top, u32 bot, int semi);
void hex_outline(int cx, int cy, int r, int t, u32 rgb, int semi);
int  text_width(const char *s, int scale256);
void text(int x, int y, const char *s, int scale256, u32 rgb);
void text_shadow(int x, int y, const char *s, int scale256, u32 rgb);
void text_center(int cx, int y, const char *s, int scale256, u32 rgb);
int  digits_width(const char *s, int scale256);
void digits(int x, int y, const char *s, int scale256, u32 rgb);
extern u32 frame_count;

/* pad.c */
void pad_init(void);
u16  pad_read(void);

/* spu.c */
void spu_init(void);
void spu_tone(int midi_note, int frames, int vol);
void spu_update(void);

#endif

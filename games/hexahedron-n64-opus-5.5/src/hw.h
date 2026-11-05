/* Bare-metal N64 hardware access: register blocks, cache helpers, small libc bits.
 * No SDK. Everything is polled; interrupts stay disabled. */
#ifndef HW_H
#define HW_H

typedef unsigned char u8;
typedef signed char s8;
typedef unsigned short u16;
typedef signed short s16;
typedef unsigned int u32;
typedef signed int s32;
typedef unsigned long long u64;
typedef signed long long s64;
typedef unsigned int size_t;
#define NULL ((void *)0)

#define REG(a) (*(volatile u32 *)(a))
#define UNCACHED(p) ((void *)(((u32)(p) & 0x1FFFFFFF) | 0xA0000000))
#define PHYS(p) ((u32)(p) & 0x1FFFFFFF)

/* Video interface */
#define VI_CTRL     REG(0xA4400000)
#define VI_ORIGIN   REG(0xA4400004)
#define VI_WIDTH    REG(0xA4400008)
#define VI_V_INTR   REG(0xA440000C)
#define VI_V_CURRENT REG(0xA4400010)
#define VI_BURST    REG(0xA4400014)
#define VI_V_SYNC   REG(0xA4400018)
#define VI_H_SYNC   REG(0xA440001C)
#define VI_LEAP     REG(0xA4400020)
#define VI_H_VIDEO  REG(0xA4400024)
#define VI_V_VIDEO  REG(0xA4400028)
#define VI_V_BURST  REG(0xA440002C)
#define VI_X_SCALE  REG(0xA4400030)
#define VI_Y_SCALE  REG(0xA4400034)

/* RDP command interface */
#define DPC_START   REG(0xA4100000)
#define DPC_END     REG(0xA4100004)
#define DPC_CURRENT REG(0xA4100008)
#define DPC_STATUS  REG(0xA410000C)

/* Peripheral (cartridge) interface */
#define PI_DRAM_ADDR REG(0xA4600000)
#define PI_CART_ADDR REG(0xA4600004)
#define PI_WR_LEN    REG(0xA460000C)
#define PI_STATUS    REG(0xA4600010)

/* Serial interface (PIF / controllers) */
#define SI_DRAM_ADDR     REG(0xA4800000)
#define SI_PIF_AD_RD64B  REG(0xA4800004)
#define SI_PIF_AD_WR64B  REG(0xA4800010)
#define SI_STATUS        REG(0xA4800018)

/* Audio interface */
#define AI_DRAM_ADDR REG(0xA4500000)
#define AI_LEN       REG(0xA4500004)
#define AI_CONTROL   REG(0xA4500008)
#define AI_STATUS    REG(0xA450000C)
#define AI_DACRATE   REG(0xA4500010)
#define AI_BITRATE   REG(0xA4500014)

static inline u32 c0_count(void) { u32 v; __asm__ volatile("mfc0 %0, $9" : "=r"(v)); return v; }
#define COUNT_HZ 46875000u

static inline void dcache_writeback(void *p, u32 len)
{
    u32 a = (u32)p & ~15u, e = (u32)p + len;
    for (; a < e; a += 16) __asm__ volatile("cache 0x19, 0(%0)" :: "r"(a));
}
static inline void dcache_invalidate(void *p, u32 len)
{
    u32 a = (u32)p & ~15u, e = (u32)p + len;
    for (; a < e; a += 16) __asm__ volatile("cache 0x11, 0(%0)" :: "r"(a));
}

void *memset(void *d, int c, size_t n);
void *memcpy(void *d, const void *s, size_t n);
int strlen(const char *s);

/* ROM data files (tools/mkrom.py): table at ROM 0x00100000 */
void rom_read(void *dst, u32 rom_off, u32 len);
u32 rom_file(int idx, u32 *size);

/* heap: bump allocator between the program and the frame buffers */
void *halloc(u32 size);
u32 heap_mark(void);
void heap_reset(u32 mark);

#endif

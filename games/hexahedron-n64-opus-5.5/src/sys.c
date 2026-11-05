/* libc bits, ROM access over PI DMA, and a bump heap. */
#include "hw.h"

void *memset(void *d, int c, size_t n)
{
    u8 *p = d;
    if (!(((u32)p | n) & 3)) {
        u32 v = (u8)c * 0x01010101u, *w = (u32 *)p;
        for (n >>= 2; n; n--) *w++ = v;
        return d;
    }
    while (n--) *p++ = (u8)c;
    return d;
}

void *memcpy(void *d, const void *s, size_t n)
{
    u8 *a = d;
    const u8 *b = s;
    if (!(((u32)a | (u32)b | n) & 3)) {
        u32 *wa = (u32 *)a;
        const u32 *wb = (const u32 *)b;
        for (n >>= 2; n; n--) *wa++ = *wb++;
        return d;
    }
    while (n--) *a++ = *b++;
    return d;
}

int strlen(const char *s) { int n = 0; while (s[n]) n++; return n; }

static void pi_wait(void) { while (PI_STATUS & 3) {} }

/* DMA len bytes from ROM offset to dst. dst must be 8-byte aligned; the tail that
 * doesn't fit a 2-byte DMA is fetched with an uncached ROM read. */
void rom_read(void *dst, u32 rom_off, u32 len)
{
    u32 chunk;
    u8 *d = dst;
    while (len) {
        chunk = len > 0x10000 ? 0x10000 : (len & ~1u);
        if (!chunk) {
            u32 w = REG(0xB0000000 | (rom_off & ~3u));
            *d = (u8)(w >> (24 - 8 * (rom_off & 3)));
            return;
        }
        dcache_writeback(d, chunk);
        dcache_invalidate(d, chunk);
        pi_wait();
        PI_DRAM_ADDR = PHYS(d);
        PI_CART_ADDR = 0x10000000 | rom_off;
        PI_WR_LEN = chunk - 1;
        pi_wait();
        PI_STATUS = 2;
        dcache_invalidate(d, chunk);
        d += chunk; rom_off += chunk; len -= chunk;
    }
}

#define DATA_BASE 0x00100000u
u32 rom_file(int idx, u32 *size)
{
    u32 off = REG(0xB0000000 | (DATA_BASE + 4 + 8 * idx));
    if (size) *size = REG(0xB0000000 | (DATA_BASE + 8 + 8 * idx));
    return off;
}

extern char _end[];
#define HEAP_TOP 0x80500000u
static u32 heap_ptr;
void *halloc(u32 size)
{
    if (!heap_ptr) heap_ptr = ((u32)_end + 15) & ~15u;
    u32 p = heap_ptr;
    heap_ptr = (heap_ptr + size + 15) & ~15u;
    if (heap_ptr > HEAP_TOP) {
        extern void crash(u32, u32, u32);
        crash(0xDEAD, p, size);
    }
    return (void *)p;
}
u32 heap_mark(void) { if (!heap_ptr) heap_ptr = ((u32)_end + 15) & ~15u; return heap_ptr; }
void heap_reset(u32 mark) { heap_ptr = mark; }

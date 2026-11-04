/* SPU: one looping ADPCM block holding a single sine period, played at
 * different pitches on 8 round-robin voices. Notes can be delayed to make
 * little jingles. */
#include "hw.h"

#define SAMPLE_ADDR 0x1000
#define NVOICES 8
#define QLEN 16

static const s8 sine28[28] = {
    0, 2, 3, 4, 5, 6, 7, 7, 7, 6, 5, 4, 3, 2,
    0,-2,-3,-4,-5,-6,-7,-7,-7,-6,-5,-4,-3,-2,
};

/* pitch register for C4..B4 (0x1000 = 44.1 kHz, 28 samples per cycle) */
static const u16 octave4[12] = { 680, 721, 764, 809, 857, 908, 962, 1019, 1080, 1144, 1212, 1284 };

static int voice_timer[NVOICES];
static int next_voice;

static struct { int note, frames, vol, delay; } queue[QLEN];

static void spu_wait(void)
{
    volatile int i;
    for (i = 0; i < 200; i++) ;
}

void spu_init(void)
{
    u8 block[16];
    int i;

    SPU_CTRL = 0;
    spu_wait();
    SPU_CTRL = 0xC000;                      /* enable, unmute */
    SPU_MAIN_VOL_L = 0x3FFF;
    SPU_MAIN_VOL_R = 0x3FFF;
    SPU_REVERB_VOL_L = 0;
    SPU_REVERB_VOL_R = 0;
    SPU_CD_VOL_L = SPU_CD_VOL_R = 0;
    SPU_EXT_VOL_L = SPU_EXT_VOL_R = 0;
    SPU_FM_LO = SPU_FM_HI = 0;
    SPU_NOISE_LO = SPU_NOISE_HI = 0;
    SPU_REVERB_LO = SPU_REVERB_HI = 0;
    SPU_KEY_OFF_LO = 0xFFFF;
    SPU_KEY_OFF_HI = 0x00FF;

    block[0] = 0x00;                        /* shift 0, filter 0 */
    block[1] = 0x07;                        /* loop start + loop end + repeat */
    for (i = 0; i < 14; i++)
        block[2 + i] = (sine28[i * 2] & 0xF) | ((sine28[i * 2 + 1] & 0xF) << 4);

    SPU_XFER_CTRL = 0x0004;
    SPU_ADDR = SAMPLE_ADDR >> 3;
    for (i = 0; i < 16; i += 2)
        SPU_FIFO = block[i] | (block[i + 1] << 8);
    SPU_CTRL = 0xC010;                      /* manual write */
    for (i = 0; i < 100000 && (SPU_STAT & 0x0400); i++) ;
    spu_wait();
    SPU_CTRL = 0xC000;
}

static u16 note_pitch(int n)
{
    int oct = n / 12 - 5;
    u32 p = octave4[n % 12];
    if (oct > 0) p <<= oct; else p >>= -oct;
    return p > 0x3FFF ? 0x3FFF : (u16)p;
}

static void key_on(int note, int frames, int vol)
{
    int v = next_voice;
    next_voice = (next_voice + 1) % NVOICES;
    SPU_KEY_OFF_LO = 1 << v;
    SPU_VOICE(v, 0x0) = vol;
    SPU_VOICE(v, 0x2) = vol;
    SPU_VOICE(v, 0x4) = note_pitch(note);
    SPU_VOICE(v, 0x6) = SAMPLE_ADDR >> 3;
    SPU_VOICE(v, 0x8) = 0x000F;             /* instant attack, sustain level max */
    SPU_VOICE(v, 0xA) = 0xC92A;             /* exp. fade while held, exp. release */
    SPU_VOICE(v, 0xE) = SAMPLE_ADDR >> 3;
    SPU_KEY_ON_LO = 1 << v;
    voice_timer[v] = frames;
}

/* Queue a note: midi note number, length and delay in frames, volume 0..0x3FFF */
void spu_play(int note, int frames, int vol, int delay)
{
    int i;
    if (!delay) { key_on(note, frames, vol); return; }
    for (i = 0; i < QLEN; i++)
        if (!queue[i].frames) {
            queue[i].note = note; queue[i].frames = frames;
            queue[i].vol = vol; queue[i].delay = delay;
            return;
        }
}

void spu_tone(int note, int frames, int vol) { spu_play(note, frames, vol, 0); }

void spu_update(void)
{
    int i;
    for (i = 0; i < NVOICES; i++)
        if (voice_timer[i] && !--voice_timer[i])
            SPU_KEY_OFF_LO = 1 << i;
    for (i = 0; i < QLEN; i++)
        if (queue[i].frames && !--queue[i].delay) {
            key_on(queue[i].note, queue[i].frames, queue[i].vol);
            queue[i].frames = 0;
        }
}

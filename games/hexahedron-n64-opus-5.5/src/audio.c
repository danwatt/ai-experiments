/* Sound effects: a tiny fixed-point synth (square, saw, noise voices with pitch
 * sweeps and decays) mixed on the CPU into 22050 Hz stereo buffers for the AI. */
#include "hw.h"
#include "audio.h"

#define RATE 22050
#define BUF_SAMPLES 512
#define NBUF 4
#define NVOICE 12
static s16 *const abuf = (s16 *)0xA05A0000;   /* NBUF x 512 stereo frames + 1 silent */
static int next_buf, started;

enum { W_SQUARE, W_SAW, W_NOISE, W_TRI };
typedef struct { int wave; u32 phase, step; s32 step_mul; s32 vol, vol_mul; u32 lfsr; s16 hold; int pan; int life; } voice_t;
static voice_t vo[NVOICE];

void audio_init(void)
{
#ifdef NOAUDIO
    return;
#endif
    if (started) return;
    started = 1;
    memset(abuf, 0, (NBUF + 1) * BUF_SAMPLES * 4);
    AI_DACRATE = (2 * 48681812 / RATE + 1) / 2 - 1;
    AI_BITRATE = 15;
    AI_CONTROL = 1;
}

/* freq in Hz, sweep: pitch multiplier per second (1.0 = none), decay: volume
   multiplier per second, dur in seconds, vol 0..1 */
static void voice(int wave, float freq, float sweep, float vol, float decay, float dur, int pan)
{
    int best = 0;
    for (int i = 0; i < NVOICE; i++) {
        if (vo[i].life <= 0) { best = i; break; }
        if (vo[i].vol < vo[best].vol) best = i;
    }
    voice_t *v = &vo[best];
    v->wave = wave;
    v->phase = 0;
    v->step = (u32)(freq * (4294967296.0f / RATE));
    /* per-block (32 samples) multipliers in 16.16 */
    float blocks = RATE / 32.0f;
    float sm = 1.0f, dm = 1.0f;
    /* x^(1/blocks) by repeated sqrt approximation: use exp/log-free iteration */
    {
        float a = sweep, b = decay;
        /* nth root via Newton on a few steps */
        float r1 = 1.0f, r2 = 1.0f;
        for (int k = 0; k < 30; k++) {
            float p1 = 1, p2 = 1;
            int n = (int)blocks;
            /* fast pow via squaring */
            float b1 = r1, b2 = r2; int e = n;
            while (e) { if (e & 1) { p1 *= b1; p2 *= b2; } b1 *= b1; b2 *= b2; e >>= 1; }
            r1 -= (p1 - a) / (n * p1 / r1);
            r2 -= (p2 - b) / (n * p2 / r2);
            if (r1 < 0.5f) r1 = 0.5f;
            if (r2 < 0.5f) r2 = 0.5f;
        }
        sm = r1; dm = r2;
    }
    v->step_mul = (s32)(sm * 65536.0f);
    v->vol = (s32)(vol * 9000.0f) << 8;
    v->vol_mul = (s32)(dm * 65536.0f);
    v->lfsr = 0xACE1u + (u32)best * 77;
    v->hold = 0;
    v->pan = pan;
    v->life = (int)(dur * RATE);
}

void sfx(int id)
{
    if (!started) return;
    switch (id) {
    case SFX_LASER:   voice(W_SQUARE, 1500, 0.08f, 0.35f, 0.002f, 0.14f, 0); voice(W_SAW, 900, 0.2f, 0.2f, 0.01f, 0.12f, 0); break;
    case SFX_SPREAD:  voice(W_SAW, 700, 3.0f, 0.3f, 0.004f, 0.12f, 0); voice(W_SQUARE, 500, 2.0f, 0.2f, 0.01f, 0.1f, 0); break;
    case SFX_MISSILE: voice(W_NOISE, 2500, 0.05f, 0.45f, 0.08f, 0.5f, 0); voice(W_SAW, 160, 0.3f, 0.35f, 0.05f, 0.45f, 0); break;
    case SFX_BOOM:    voice(W_NOISE, 1400, 0.03f, 0.75f, 0.05f, 0.9f, 0); voice(W_TRI, 90, 0.2f, 0.6f, 0.03f, 0.7f, 0); break;
    case SFX_BIGBOOM: voice(W_NOISE, 900, 0.05f, 1.0f, 0.2f, 2.0f, 0); voice(W_TRI, 60, 0.3f, 0.9f, 0.15f, 1.8f, 0); voice(W_NOISE, 3000, 0.1f, 0.5f, 0.1f, 1.2f, 0); break;
    case SFX_HIT:     voice(W_NOISE, 4000, 0.3f, 0.3f, 0.0005f, 0.08f, 0); break;
    case SFX_WALL:    voice(W_NOISE, 2000, 0.3f, 0.18f, 0.0005f, 0.06f, 0); break;
    case SFX_HURT:    voice(W_SAW, 220, 0.25f, 0.5f, 0.01f, 0.25f, 0); voice(W_NOISE, 1200, 0.3f, 0.3f, 0.01f, 0.2f, 0); break;
    case SFX_PICKUP:  voice(W_SQUARE, 600, 4.0f, 0.3f, 0.05f, 0.25f, 0); voice(W_TRI, 900, 4.0f, 0.3f, 0.05f, 0.25f, 0); break;
    case SFX_WEAPON:  voice(W_SQUARE, 400, 6.0f, 0.35f, 0.1f, 0.4f, 0); voice(W_SAW, 300, 6.0f, 0.2f, 0.1f, 0.4f, 0); break;
    case SFX_KEY:     voice(W_TRI, 523, 1, 0.45f, 0.2f, 0.6f, 0); voice(W_TRI, 784, 1, 0.35f, 0.2f, 0.6f, 0); voice(W_SQUARE, 1046, 1, 0.15f, 0.1f, 0.5f, 0); break;
    case SFX_DOOR:    voice(W_NOISE, 300, 0.6f, 0.35f, 0.3f, 0.7f, 0); voice(W_SAW, 70, 1.3f, 0.3f, 0.3f, 0.7f, 0); break;
    case SFX_LOCKED:  voice(W_SQUARE, 180, 1, 0.3f, 0.05f, 0.18f, 0); voice(W_SQUARE, 150, 1, 0.3f, 0.05f, 0.3f, 0); break;
    case SFX_ESHOT:   voice(W_SQUARE, 760, 0.25f, 0.2f, 0.01f, 0.15f, 0); break;
    case SFX_PLASMA:  voice(W_SAW, 260, 0.4f, 0.3f, 0.05f, 0.3f, 0); voice(W_TRI, 130, 0.5f, 0.3f, 0.05f, 0.3f, 0); break;
    case SFX_ALARM:   voice(W_SQUARE, 880, 0.6f, 0.25f, 0.2f, 0.35f, 0); break;
    case SFX_MENU:    voice(W_TRI, 660, 1, 0.3f, 0.01f, 0.08f, 0); break;
    case SFX_START:   voice(W_TRI, 330, 4.0f, 0.4f, 0.2f, 0.6f, 0); voice(W_SQUARE, 165, 4.0f, 0.2f, 0.2f, 0.6f, 0); break;
    case SFX_EMPTY:   voice(W_SQUARE, 120, 1, 0.25f, 0.01f, 0.1f, 0); break;
    case SFX_SIZZLE:  voice(W_NOISE, 6000, 0.5f, 0.25f, 0.05f, 0.3f, 0); break;
    }
}

static void mix(s16 *out)
{
    static s32 acc[BUF_SAMPLES];
    for (int i = 0; i < BUF_SAMPLES; i++) acc[i] = 0;
    for (int n = 0; n < NVOICE; n++) {
        voice_t *v = &vo[n];
        if (v->life <= 0) continue;
        for (int b = 0; b < BUF_SAMPLES; b += 32) {
            s32 amp = v->vol >> 8;
            for (int i = b; i < b + 32; i++) {
                s32 s;
                u32 ph = v->phase;
                v->phase += v->step;
                switch (v->wave) {
                case W_SQUARE: s = (ph & 0x80000000u) ? amp : -amp; break;
                case W_SAW: s = (s32)(((s64)((s32)ph >> 16) * amp) >> 15); break;
                case W_TRI: { s32 t = (s32)(ph >> 16); t = t < 32768 ? t * 2 - 32768 : (65535 - t) * 2 - 32768; s = (s32)(((s64)t * amp) >> 15); break; }
                default:
                    if (v->phase < ph) {   /* wrapped: next noise value */
                        v->lfsr = (v->lfsr >> 1) ^ (u32)(-(s32)(v->lfsr & 1u) & 0xB400u);
                        v->hold = (s16)((v->lfsr & 1) ? 1 : -1);
                    }
                    s = v->hold * amp;
                    break;
                }
                acc[i] += s;
            }
            v->step = (u32)(((u64)v->step * (u32)v->step_mul) >> 16);
            v->vol = (s32)(((s64)v->vol * v->vol_mul) >> 16);
            v->life -= 32;
            if (v->life <= 0) break;
        }
    }
    for (int i = 0; i < BUF_SAMPLES; i++) {
        s32 s = acc[i];
        if (s > 32000) s = 32000;
        if (s < -32000) s = -32000;
        out[2 * i] = out[2 * i + 1] = (s16)s;
    }
}

void audio_update(void)
{
#ifdef NOAUDIO
    return;
#endif
    if (!started) return;
    for (int k = 0; k < 2; k++) {
        if (AI_STATUS & 0x80000000u) return;   /* FIFO full */
        s16 *b = abuf + next_buf * BUF_SAMPLES * 2;
        int active = 0;
        for (int i = 0; i < NVOICE; i++) if (vo[i].life > 0) { active = 1; break; }
        if (active) mix(b);
        else b = abuf + NBUF * BUF_SAMPLES * 2;      /* shared silent buffer */
        AI_DRAM_ADDR = PHYS(b);
        AI_LEN = BUF_SAMPLES * 4;
        next_buf = (next_buf + 1) % NBUF;
    }
}

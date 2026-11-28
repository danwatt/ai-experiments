/* SPU: sound bank upload, hardware reverb, a row-based music sequencer on
 * voices 0-9 and pitched sine effects on voices 16-23.
 *
 * Songs (see music/hexsong.py) are lists of note events per track, each track
 * bound to one voice. The sequencer advances one sixteenth-note row every
 * song.frames_per_row frames. Key-on/key-off requests are collected during
 * the frame and written to the SPU together at the end of spu_update(). */
#include "audio.h"

#define SFX_FIRST  16
#define SFX_VOICES 8
#define QLEN 16
#define CTRL_ON    0xC080                   /* enable, unmute, reverb master */

#define REVERB_SIZE 0x4840                  /* "Studio Medium" work area */
#define REVERB_REG(i) REG16(0x1F801DC0 + (i) * 2)
#define SPU_REVERB_BASE REG16(0x1F801DA2)

static const u16 reverb_studio_medium[32] = {
    0x00B1, 0x007F, 0x70F0, 0x4FA8, 0xBCE0, 0x4510, 0xBEF0, 0xB4C0,
    0x5280, 0x4EC0, 0x0904, 0x076B, 0x0824, 0x065F, 0x07A2, 0x0616,
    0x076C, 0x05ED, 0x05EC, 0x042E, 0x050F, 0x0305, 0x0462, 0x02B7,
    0x042F, 0x0265, 0x0264, 0x01B2, 0x0100, 0x0080, 0x8000, 0x8000,
};

/* 2^(k/12) in 16.16 */
static const u32 semitone[12] = {
    65536, 69433, 73562, 77936, 82570, 87480, 92682, 98193, 104032, 110218, 116772, 123715,
};

static const s8 lfo[16] = { 0, 24, 45, 59, 64, 59, 45, 24, 0, -24, -45, -59, -64, -59, -45, -24 };

static u32 kon, koff;                       /* pending key on/off masks */

static struct {
    u16 pitch;                              /* base pitch, for vibrato */
    u16 vol_l, vol_r;                       /* volume before music gain */
    u16 rows_left;                          /* music: rows until key-off */
    u16 frames_left;                        /* sfx: frames until key-off */
    u8 vib, age;
} voice[24];

static int next_sfx;
static struct { int note, frames, vol, delay; } queue[QLEN];

static const Song *song;
static int row, frame, layers = 3;
static u16 ev_pos[16];
static int gain = 256, gain_target = 256, fade_stop;

/* ------------------------------------------------------------ hardware */

static void spin(int n)
{
    volatile int i;
    for (i = 0; i < n; i++) ;
}

static void set_ctrl(u16 v)
{
    int t;
    SPU_CTRL = v;
    for (t = 0; t < 10000 && (SPU_STAT & 0x3F) != (v & 0x3F); t++) ;
}

/* Manual write through the 32-halfword transfer FIFO; data = 0 writes zeros. */
static void spu_upload(u32 addr, const u8 *data, u32 len)
{
    u32 i, j;
    SPU_XFER_CTRL = 0x0004;
    SPU_ADDR = addr >> 3;
    for (i = 0; i < len; i += 64) {
        u32 n = len - i < 64 ? len - i : 64;
        int t;
        for (j = 0; j < n; j += 2)
            SPU_FIFO = data ? data[i + j] | (data[i + j + 1] << 8) : 0;
        set_ctrl(CTRL_ON | 0x10);
        spin(20);
        for (t = 0; t < 100000 && (SPU_STAT & 0x0400); t++) ;
        set_ctrl(CTRL_ON);
    }
}

static u16 note_pitch(u16 root, int note)
{
    int d = note - 69, oct = 0;
    u32 p;
    while (d < 0) { d += 12; oct--; }
    while (d >= 12) { d -= 12; oct++; }
    p = (root * semitone[d]) >> 16;
    p = oct >= 0 ? p << oct : p >> -oct;
    return p > 0x3FFF ? 0x3FFF : (u16)p;
}

static void apply_volume(int v)
{
    int g = v < SFX_FIRST ? gain : 256;
    SPU_VOICE(v, 0x0) = voice[v].vol_l * g >> 8;
    SPU_VOICE(v, 0x2) = voice[v].vol_r * g >> 8;
}

static void start_voice(int v, const Inst *in, int note, int vel, int pan)
{
    u32 vol = in->vol * (u32)vel / 127;
    u32 l = 2 * (255 - pan), r = 2 * pan;
    if (l > 255) l = 255;
    if (r > 255) r = 255;
    voice[v].vol_l = vol * l / 255;
    voice[v].vol_r = vol * r / 255;
    voice[v].pitch = note_pitch(in->pitch, note);
    voice[v].vib = (in->flags & INST_VIBRATO) != 0;
    voice[v].age = 0;
    apply_volume(v);
    SPU_VOICE(v, 0x4) = voice[v].pitch;
    SPU_VOICE(v, 0x6) = in->addr;
    SPU_VOICE(v, 0x8) = in->adsr1;
    SPU_VOICE(v, 0xA) = in->adsr2;
    /* one-shots fall into the silent loop when they end */
    SPU_VOICE(v, 0xE) = (in->flags & INST_LOOP) ? in->addr : SPU_SILENCE_ADDR >> 3;
    kon |= 1u << v;
}

void spu_init(void)
{
    static const u8 silence[16] = { 0x00, 0x07 };
    int i;

    SPU_CTRL = 0;
    spin(2000);
    set_ctrl(0xC000);
    SPU_MAIN_VOL_L = SPU_MAIN_VOL_R = 0x3FFF;
    SPU_REVERB_VOL_L = SPU_REVERB_VOL_R = 0;
    SPU_CD_VOL_L = SPU_CD_VOL_R = 0;
    SPU_EXT_VOL_L = SPU_EXT_VOL_R = 0;
    SPU_FM_LO = SPU_FM_HI = 0;
    SPU_NOISE_LO = SPU_NOISE_HI = 0;
    SPU_KEY_OFF_LO = 0xFFFF;
    SPU_KEY_OFF_HI = 0x00FF;
    for (i = 0; i < 24; i++) {
        SPU_VOICE(i, 0x0) = SPU_VOICE(i, 0x2) = 0;
    }

    /* clear the reverb work area at the top of SPU RAM, then upload the bank */
    SPU_REVERB_BASE = (0x80000 - REVERB_SIZE) >> 3;
    spu_upload(0x80000 - REVERB_SIZE, 0, REVERB_SIZE);
    spu_upload(SPU_SILENCE_ADDR, silence, 16);
    spu_upload(SPU_BANK_ADDR, spu_bank, spu_bank_size);

    for (i = 0; i < 32; i++)
        REVERB_REG(i) = reverb_studio_medium[i];
    SPU_REVERB_VOL_L = SPU_REVERB_VOL_R = 0x2400;
    {
        u32 eon = 0;
        for (i = 0; i < 16; i++) {
            /* music voices whose instrument (in either song) asks for reverb */
            int s, t;
            for (s = 0; s < 2; s++)
                for (t = 0; t < songs[s].ntracks; t++)
                    if (songs[s].tracks[t].voice == i &&
                        (instruments[songs[s].tracks[t].inst].flags & INST_REVERB))
                        eon |= 1u << i;
        }
        SPU_REVERB_LO = eon & 0xFFFF;
        SPU_REVERB_HI = eon >> 16;
    }
    set_ctrl(CTRL_ON);
}

/* ------------------------------------------------------------ effects */

static void sfx_on(int note, int frames, int vol)
{
    int v = SFX_FIRST + next_sfx;
    Inst in = instruments[INST_SFX];
    next_sfx = (next_sfx + 1) % SFX_VOICES;
    in.vol = vol;
    koff &= ~(1u << v);
    start_voice(v, &in, note, 127, 128);
    voice[v].frames_left = frames;
}

/* Queue a note: midi note number, length and delay in frames, volume 0..0x3FFF */
void spu_play(int note, int frames, int vol, int delay)
{
    int i;
    if (!delay) { sfx_on(note, frames, vol); return; }
    for (i = 0; i < QLEN; i++)
        if (!queue[i].frames) {
            queue[i].note = note; queue[i].frames = frames;
            queue[i].vol = vol; queue[i].delay = delay;
            return;
        }
}

/* ------------------------------------------------------------ music */

static void silence_music(void)
{
    int i;
    for (i = 0; i < SFX_FIRST; i++) {
        voice[i].rows_left = 0;
        voice[i].vib = 0;
    }
    koff |= 0xFFFF;
    kon &= ~0xFFFFu;
}

void music_play(int s)
{
    silence_music();
    song = &songs[s];
    row = frame = 0;
    memset(ev_pos, 0, sizeof(ev_pos));
    fade_stop = 0;
}

void music_fade_out(void)
{
    gain_target = 0;
    fade_stop = 1;
}

void music_set_layers(int n) { layers = n; }

void music_set_gain(int g)
{
    gain_target = g;
    fade_stop = 0;
}

static void music_row(void)
{
    u32 started = 0;
    int t, v;

    for (v = 0; v < SFX_FIRST; v++)
        if (voice[v].rows_left && !--voice[v].rows_left)
            koff |= 1u << v;

    for (t = 0; t < song->ntracks; t++) {
        const Track *tr = &song->tracks[t];
        while (ev_pos[t] < tr->count && tr->ev[ev_pos[t]].row == row) {
            const Event *e = &tr->ev[ev_pos[t]++];
            if (tr->layer > layers) continue;
            start_voice(tr->voice, &instruments[tr->inst], e->note, e->vel, e->pan);
            voice[tr->voice].rows_left = e->len;
            started |= 1u << tr->voice;
        }
    }
    koff &= ~started;                       /* retrigger instead of release */
}

static void music_frame(void)
{
    int v;

    if (gain != gain_target) {
        gain += gain < gain_target ? 8 : -8;
        if (gain > 256) gain = 256;
        if (gain < 0) gain = 0;
        if ((gain_target - gain) * (gain_target - gain) < 64) gain = gain_target;
        for (v = 0; v < SFX_FIRST; v++) apply_volume(v);
        if (!gain && fade_stop) {
            silence_music();
            song = 0;
            gain = gain_target = 256;
            fade_stop = 0;
        }
    }

    for (v = 0; v < SFX_FIRST; v++)
        if (voice[v].vib && ++voice[v].age > 18) {
            int p = voice[v].pitch;
            voice[v].age = 19;
            SPU_VOICE(v, 0x4) = p + (p * lfo[(frame_count >> 1) & 15] >> 13);
        }

    if (!song) return;
    if (frame == 0) music_row();
    if (++frame >= song->frames_per_row) {
        frame = 0;
        if (++row >= song->rows) {
            row = 0;
            memset(ev_pos, 0, sizeof(ev_pos));
        }
    }
}

void spu_update(void)
{
    int i;
    for (i = SFX_FIRST; i < 24; i++)
        if (voice[i].frames_left && !--voice[i].frames_left)
            koff |= 1u << i;
    for (i = 0; i < QLEN; i++)
        if (queue[i].frames && !--queue[i].delay) {
            sfx_on(queue[i].note, queue[i].frames, queue[i].vol);
            queue[i].frames = 0;
        }
    music_frame();

    if (koff) {
        SPU_KEY_OFF_LO = koff & 0xFFFF;
        SPU_KEY_OFF_HI = koff >> 16;
    }
    if (kon) {
        SPU_KEY_ON_LO = kon & 0xFFFF;
        SPU_KEY_ON_HI = kon >> 16;
    }
    kon = koff = 0;
}

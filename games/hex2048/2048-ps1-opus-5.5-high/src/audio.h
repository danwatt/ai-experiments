/* Sound bank and song data, generated at build time by tools/gen_audio.py
 * from music/hexsong.py into build/audio_data.c. */
#ifndef AUDIO_H
#define AUDIO_H
#include "hw.h"

#define SPU_SILENCE_ADDR 0x1000     /* one looping silent block */
#define SPU_BANK_ADDR    0x1010     /* sample bank follows it */

#define INST_LOOP    1              /* single-cycle waveform (loops forever) */
#define INST_REVERB  2              /* send to the reverb unit */
#define INST_VIBRATO 4              /* delayed pitch vibrato */

typedef struct {
    u16 addr;                       /* SPU RAM address / 8 */
    u16 pitch;                      /* pitch register value for note 69 (A4) */
    u16 adsr1, adsr2;
    u16 vol;                        /* full-velocity voice volume, 0..3FFF */
    u16 flags;
} Inst;

typedef struct {
    u16 row;                        /* sixteenth-note row within the song */
    u8 note;                        /* MIDI note */
    u8 vel;                         /* 0..127 */
    u8 len;                         /* rows until key-off, 0 = let it ring */
    u8 pan;                         /* 0 = left, 128 = centre, 255 = right */
} Event;

typedef struct {
    const Event *ev;
    u16 count;
    u8 inst, layer, voice;
} Track;

typedef struct {
    const Track *tracks;
    u16 ntracks;
    u16 rows;
    u16 frames_per_row;
} Song;

enum { INST_SFX = 0 };              /* first instrument: plain sine for effects */
enum { SONG_TITLE = 0, SONG_GAME = 1 };

extern const u8 spu_bank[];
extern const u32 spu_bank_size;
extern const Inst instruments[];
extern const Song songs[];

/* spu.c */
void spu_init(void);
void spu_update(void);
void spu_play(int note, int frames, int vol, int delay);
void music_play(int song);
void music_fade_out(void);
void music_set_layers(int n);
void music_set_gain(int g);         /* 0..256, ramps smoothly */

#endif

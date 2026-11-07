"""Hex 2048 soundtrack, written as data. Everything leans on six:

  * 6/4 time: six beats per bar, felt as 3+3 by the drums while the bass
    walks 2+2+2 underneath (a hemiola)
  * 6 frames per sixteenth-note row (150 bpm at 60 Hz)
  * melodies use a hexatonic scale: A B C D E G (A minor without F)
  * the arpeggio plays 6-note cells, which cut across the 4-sixteenth beat,
    and pans each of the six notes to its own spot in the stereo field
  * phrases are 6 bars long, and the in-game song is 6 phrases
  * the bridge ends on two augmented triads, D-F#-A# and E-G#-C, which
    together are the 6-note whole-tone scale; E-G#-C pulls home to A minor
  * 6 parts: lead, bell, arpeggio, pad, bass, drums

gen_audio.py turns this into event lists for the sequencer in spu.c.
"""

ROWS_PER_BEAT = 4
BEATS_PER_BAR = 6
ROWS_PER_BAR = ROWS_PER_BEAT * BEATS_PER_BAR    # 24
FRAMES_PER_ROW = 6

# name: (bass root, bass fifth), pad triad, arpeggio tones (low to high)
CHORDS = {
    "Am":    ((45, 52), (57, 60, 64), (64, 69, 72, 76)),
    "C":     ((48, 55), (55, 60, 64), (64, 67, 72, 76)),
    "G":     ((43, 50), (55, 59, 62), (62, 67, 71, 74)),
    "Em":    ((40, 47), (55, 59, 64), (64, 67, 71, 76)),
    "Dsus2": ((38, 45), (57, 62, 64), (62, 64, 69, 74)),
    "Esus4": ((40, 47), (57, 59, 64), (64, 69, 71, 76)),
    "Daug":  ((38, 46), (54, 58, 62), (62, 66, 70, 74)),
    "Eaug":  ((40, 48), (56, 60, 64), (64, 68, 72, 76)),
}

VERSE = ["Am", "C", "G", "Em", "Dsus2", "Esus4"]
BRIDGE = ["C", "Dsus2", "Em", "G", "Daug", "Eaug"]

# One string per bar: note:sixteenths, "r" is a rest. Each bar sums to 24.
THEME = [
    "E5:6 D5:2 C5:4 A4:6 B4:2 C5:4",
    "G5:6 E5:6 D5:4 C5:4 D5:4",
    "B4:6 D5:6 G5:8 A5:2 G5:2",
    "E5:12 D5:4 B4:4 G4:4",
    "A4:6 B4:2 D5:4 E5:6 D5:2 A4:4",
    "B4:12 A4:6 r:6",
]
ANSWER = [
    "A5:6 G5:2 E5:4 C5:6 D5:2 E5:4",
    "G5:4 E5:4 G5:4 A5:6 G5:6",
    "D5:6 B4:6 D5:4 G5:4 B5:4",
    "A5:6 G5:6 E5:12",
    "D5:6 E5:2 A5:4 G5:6 E5:2 D5:4",
    "E5:18 r:6",
]
BRIDGE_TUNE = [
    "E5:12 G5:12",
    "A5:12 E5:12",
    "G5:6 B5:6 A5:6 G5:6",
    "D5:18 B4:6",
    "D5:4 F#5:4 A#5:4 D6:4 A#5:4 F#5:4",
    "E5:4 G#5:4 C6:4 E6:4 C6:4 G#5:4",
]

# Track name: (voice, instrument, layer). Layer 0 always plays; higher layers
# join in as the player's best tile grows (see music_set_layers in game.c).
TRACKS = {
    "lead":  (0, "lead", 2),
    "bell":  (1, "bell", 3),
    "arp":   (2, "pluck", 1),
    "pad0":  (3, "pad", 0),
    "pad1":  (4, "pad", 0),
    "pad2":  (5, "pad", 0),
    "bass":  (6, "bass", 0),
    "kick":  (7, "kick", 0),
    "snare": (8, "snare", 0),
    "hat":   (9, "hat", 0),
}

ARP_SHAPE = (0, 1, 2, 3, 2, 1)                 # six-note up/down cell
ARP_PAN = (48, 88, 168, 208, 168, 88)          # low notes left, high notes right
PAD_PAN = (64, 128, 192)

NOTE_BASE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def note_number(name):
    n = NOTE_BASE[name[0]]
    i = 1
    if name[i] == "#":
        n += 1
        i += 1
    return n + 12 * (int(name[i:]) + 1)


def melody_bar(text, vel):
    out, row = [], 0
    for tok in text.split():
        name, dur = tok.split(":")
        dur = int(dur)
        if name != "r":
            out.append((row, note_number(name), vel, dur - 1 if dur > 2 else dur, 128))
        row += dur
    assert row == ROWS_PER_BAR, text
    return out


def drum_bar(style, fill):
    kick, snare, hat = [], [], []
    if style == "none":
        return kick, snare, hat
    if style == "light":
        kick = [(0, 69, 110, 0, 128), (12, 69, 100, 0, 128)]
        hat = [(r, 69, 55 if r % 8 else 70, 0, 176) for r in range(0, 24, 4)]
        return kick, snare, hat
    if style == "hats":
        hat = [(r, 69, 40 if r % 8 else 55, 0, 176) for r in range(0, 24, 4)]
        return kick, snare, hat
    # full groove: kick on 1 and 4 (3+3), snare on 3 and 6, eighth-note hats
    kick = [(0, 69, 120, 0, 128), (10, 69, 80, 0, 128), (12, 69, 115, 0, 128)]
    snare = [(8, 69, 100, 0, 144), (20, 69, 105, 0, 144)]
    hat = [(r, 69, 70 if r % 4 == 0 else 42, 0, 176) for r in range(0, 24, 2)]
    if fill:
        snare = [(8, 69, 100, 0, 144)] + [(r, 69, 60 + (r - 12) * 6, 0, 144)
                                           for r in (12, 14, 16, 18, 20, 21, 22, 23)]
        hat = [h for h in hat if h[0] < 12]
    return kick, snare, hat


def phrase(chords, melody=None, bell=False, drums="full", fill=False,
           arp=True, bass=True, soft=False):
    """Six bars. Returns {track: [(row, note, vel, len, pan)]} from row 0."""
    t = {name: [] for name in TRACKS}
    for bar, name in enumerate(chords):
        base = bar * ROWS_PER_BAR
        (root, fifth), pad, tones = CHORDS[name]

        for i, n in enumerate(pad):
            t["pad%d" % i].append((base, n, 60 if soft else 72, ROWS_PER_BAR, PAD_PAN[i]))

        if arp:
            for r in range(ROWS_PER_BAR):
                k = r % 6
                vel = (70 if k == 0 else 50) if soft else (88 if k == 0 else 62)
                t["arp"].append((base + r, tones[ARP_SHAPE[k]], vel, 1, ARP_PAN[k]))

        if bass:
            for r, n, v, ln in ((0, root, 104, 7), (8, fifth, 88, 7),
                                (16, root + 12, 92, 5), (22, fifth, 70, 2)):
                t["bass"].append((base + r, n, v, ln, 128))

        if melody:
            vel = 84 if soft else 104
            t["lead"] += [(base + r, n, v, ln, p) for r, n, v, ln, p in melody_bar(melody[bar], vel)]

        if bell:
            for i, k in enumerate((1, 2, 3, 2)):
                t["bell"].append((base + i * 6, tones[k] + 12, 76, 5, 160))

        k, s, h = drum_bar(drums, fill and bar == len(chords) - 1)
        for name_, ev in (("kick", k), ("snare", s), ("hat", h)):
            t[name_] += [(base + r, n, v, ln, p) for r, n, v, ln, p in ev]
    return t


def song(phrases):
    tracks = {name: [] for name in TRACKS}
    rows = 0
    for p in phrases:
        for name, ev in p.items():
            tracks[name] += [(rows + r, n, v, ln, pan) for r, n, v, ln, pan in ev]
        rows += 6 * ROWS_PER_BAR
    return rows, tracks


SONGS = [
    # title: no drums, just the theme drifting over pad and arpeggio
    song([
        phrase(VERSE, drums="none", bass=False, soft=True),
        phrase(VERSE, melody=THEME, drums="hats", soft=True),
    ]),
    # in game: 6 phrases of 6 bars of 6 beats
    song([
        phrase(VERSE, drums="light"),
        phrase(VERSE, melody=THEME),
        phrase(VERSE, melody=ANSWER),
        phrase(BRIDGE, melody=BRIDGE_TUNE),
        phrase(VERSE, melody=THEME, bell=True),
        phrase(VERSE, melody=ANSWER, bell=True, fill=True),
    ]),
]

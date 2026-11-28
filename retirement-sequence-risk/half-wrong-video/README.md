# "What if I'm half wrong?" — the video

A 2 minute 25 second narrated motion-graphics cut of [`../half-wrong/`](../half-wrong/), which checks the
retirement math in Dave Ramsey's *The Total Money Makeover* (2003) against real history.

- `half-wrong.mp4`: 1920×1080, 30 fps, H.264 + AAC, with the captions as a soft subtitle track (turn them on in the player)
- `half-wrong.srt`: the same captions as a separate file
- `poster.png`: the poster frame

## How it's made

| File | Does |
| --- | --- |
| `compute.js` | Runs the page's models (`../half-wrong/*.js`) on `../data.js` and `../explainer-4/funds.js` and writes `facts.json`. It also prints every figure the script quotes, for checking. |
| `narration.json` | The script: one entry per spoken line. `text` is the caption; `say` (when present) is how the voice should read it. |
| `voice.py` | Renders each line with the local Voicebox server (voice "Heart", Kokoro), the same calls as `../explainer-4/build_voice.py`, and lays out the timeline: writes `timing.json` and `half-wrong.srt`, and the voice track to the work dir. Clips are cached by text, so only changed lines re-render. |
| `scene.html` | The frames: a 1920×1080 canvas with `draw(t)`. Every number on screen comes from `facts.json`; every cue comes from `timing.json`, so the animation follows the real audio. Bluebonnet dark palette, Bricolage Grotesque and Public Sans (loaded from Google Fonts). |
| `render.js` | Drives `scene.html` in headless Chrome (puppeteer-core), pipes every frame straight into ffmpeg in six parallel segments, and joins them. No frames touch the disk. |
| `build.sh` | Runs all of the above and muxes the result. |

## Rebuild

Needs Node, Python 3, ffmpeg/ffprobe, Google Chrome in `/Applications`, network access (npm, Google Fonts),
and the Voicebox app running (`open -a Voicebox`; it serves http://127.0.0.1:17493).

```bash
cd retirement-sequence-risk/half-wrong-video
./build.sh                  # temp work dir, deleted afterwards
./build.sh /tmp/hw-work     # keep the work dir: cached voice clips make the next build faster
```

A full build takes a few minutes. To look at single frames while editing:

```bash
NODE_PATH=/tmp/hw-work/node_modules node render.js --stills 12,45.5,100 --out /tmp/stills
```

or serve the folder (`python3 -m http.server`) and open `scene.html?t=45.5`.

After editing `narration.json`, rerun `build.sh`: the timeline, captions and animation all follow the new audio.
If the data changes, `compute.js` prints the new figures; update the spoken numbers in `narration.json` to match.

## Scenes

| Time | Scene | On screen |
| --- | --- | --- |
| 0:00 | The plan | 12% − 4% = 8%; $500,000 → $40,000 a year |
| 0:12.6 | Joe and Suzy | $625 a month counts up to $7,588,545; bars for "half wrong" $4M and "six times wrong" $1,264,758; the five claims |
| 0:29.2 | Inflation | 100 years of CPI bars against Ramsey's 4%; 2.9% a year since 1926, 2.6% since the book. Holds up |
| 0:40.8 | Returns | +30, −10, +25, +3: 12.0% average, 10.8% compounded; S&P 500 1926–2002 11.9% vs 10.0%; 0 of 16 thirty-year stretches since 1981 at 12%. Half right |
| 1:05.7 | Saving | 18 real 40-year paths (three funds × six start years) end at $3.6M–$5.9M; after inflation $1.2M–$2.0M; a steady 12% makes $6.1M. Half wrong |
| 1:30.5 | Spending | Perfect 12%/4% world, today's dollars: 8% monthly runs out in year 38; 7.52% holds; $40,000 needs about $532,000. Falls short |
| 1:50.2 | Real retirements | Every 30-year S&P 500 retirement from 1926: 11 of 16 kept up since 1981; 29 of 71 since 1926, 35 ran out; 2004–2008 all fell short. Falls short, depending on the year |
| 2:14.8 | The verdict | Scorecard; saving still beats not saving; "The numbers are just too tidy." |

Fund returns are after yearly costs but not sales charges; no taxes, as on the page.

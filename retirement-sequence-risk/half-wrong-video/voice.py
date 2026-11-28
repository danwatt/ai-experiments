#!/usr/bin/env python3
"""Render the narration with the local Voicebox server, one clip per line, and lay out the timeline.

Writes:
  timing.json      scene and line start/end times in seconds (the animation keys off these)
  half-wrong.srt   captions, one per line
  <work>/narration.wav   the full voice track, silence included

Clips are cached in <work>/clips by a hash of voice + spoken text, so re-running only renders changed lines.

Usage: python3 voice.py --work /path/to/tmp [--url http://127.0.0.1:17493] [--voice Heart]
Calls the API the same way as ../explainer-4/build_voice.py. Needs ffmpeg and ffprobe.
"""
import argparse
import hashlib
import json
import shutil
import subprocess
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
RATE = 24000


def api(base, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        raw = r.read()
    return json.loads(raw) if raw else None


def tts(base, profile, text, dest):
    engine = profile.get("default_engine") or profile.get("preset_engine") or "kokoro"
    gen = api(base, "POST", "/generate", {"profile_id": profile["id"], "text": text, "language": "en", "engine": engine})
    deadline = time.time() + 600
    while gen["status"] not in ("completed", "failed", "cancelled", "error"):
        if time.time() > deadline:
            raise TimeoutError(text)
        time.sleep(0.5)
        gen = api(base, "GET", f"/history/{gen['id']}")
    if gen["status"] != "completed":
        raise RuntimeError(gen.get("error") or gen["status"])
    with urllib.request.urlopen(base + f"/audio/{gen['id']}", timeout=600) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)
    try:
        api(base, "DELETE", f"/history/{gen['id']}")
    except Exception:
        pass


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
                         capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def srt_time(t):
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True, help="scratch directory for clips and narration.wav")
    ap.add_argument("--url", default="http://127.0.0.1:17493")
    ap.add_argument("--voice")
    args = ap.parse_args()
    work = Path(args.work)
    clips = work / "clips"
    clips.mkdir(parents=True, exist_ok=True)

    spec = json.loads((HERE / "narration.json").read_text())
    voice = args.voice or spec["voice"]
    gap, lead, tail = spec["gap"], spec["lead"], spec["tail"]
    profile = None

    timeline, pieces, t = [], [], 0.0  # pieces: (wav path or None for silence, seconds)
    for scene in spec["scenes"]:
        s0 = t
        cues = []
        t += lead
        pieces.append((None, lead))
        for i, line in enumerate(scene["lines"]):
            spoken = line.get("say", line["text"])
            key = hashlib.sha1(f"{voice}\n{spoken}".encode()).hexdigest()[:16]
            wav = clips / f"{key}.wav"
            if not wav.exists():
                if profile is None:
                    profile = next(p for p in api(args.url, "GET", "/profiles") if p["name"].lower() == voice.lower())
                raw = clips / f"{key}.raw"
                print(f"  {scene['id']} {i}: {spoken}", flush=True)
                tts(args.url, profile, spoken, raw)
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-ar", str(RATE), "-ac", "1", "-f", "wav", str(wav)], check=True)
                raw.unlink()
            d = duration(wav)
            cues.append({"start": round(t, 3), "end": round(t + d, 3), "text": line["text"]})
            pieces.append((wav, d))
            t += d
            if i < len(scene["lines"]) - 1:
                pieces.append((None, gap))
                t += gap
        pieces.append((None, tail))
        t += tail
        timeline.append({"id": scene["id"], "title": scene["title"], "start": round(s0, 3), "end": round(t, 3), "cues": cues})

    total = round(t + 1.2, 3)  # end card holds a little past the last scene
    pieces.append((None, 1.2))
    (HERE / "timing.json").write_text(json.dumps({"voice": voice, "fps": 30, "duration": total, "scenes": timeline}, indent=1) + "\n")

    # captions
    n, out = 0, []
    for sc in timeline:
        for c in sc["cues"]:
            n += 1
            out.append(f"{n}\n{srt_time(c['start'])} --> {srt_time(c['end'])}\n{c['text']}\n")
    (HERE / "half-wrong.srt").write_text("\n".join(out))

    # one voice track: concatenate clips and silences
    sil = work / "silence"
    sil.mkdir(exist_ok=True)
    lst = work / "narration.txt"
    lines = []
    for p, d in pieces:
        if p is None:
            s = sil / f"{int(round(d * 1000))}.wav"
            if not s.exists():
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"anullsrc=r={RATE}:cl=mono", "-t", f"{d:.3f}", str(s)], check=True)
            p = s
        lines.append(f"file '{p}'\n")
    lst.write_text("".join(lines))
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-c:a", "pcm_s16le", str(work / "narration.wav")], check=True)
    print(f"timeline {total:.2f}s, voice track {duration(work / 'narration.wav'):.2f}s")


if __name__ == "__main__":
    main()

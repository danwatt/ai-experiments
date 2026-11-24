#!/usr/bin/env python3
"""Render the voiceover with a local Voicebox server and write narration.js.

Each line is generated separately so the page knows exactly when each
sentence starts. Lines are joined per scene with a short pause into
audio/<scene>.mp3.

Scenes whose lines haven't changed since the last render reuse their audio.

Usage: python3 build_voice.py [--url http://127.0.0.1:17493] [--voice Heart] [--all]
       python3 build_voice.py --draft   # no audio: estimate timings from word counts
Needs ffmpeg and ffprobe on PATH (not for --draft).
"""
import argparse
import json
import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
GAP = 0.32  # seconds of silence between lines
WPS = 2.6   # draft speaking rate, words per second (Kokoro Heart runs about this fast)


def api(base, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method,
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        raw = r.read()
    return json.loads(raw) if raw else None


def tts(base, profile, text, dest):
    engine = profile.get("default_engine") or profile.get("preset_engine") or "kokoro"
    gen = api(base, "POST", "/generate", {"profile_id": profile["id"], "text": text,
                                          "language": "en", "engine": engine})
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
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=nw=1:nk=1", str(path)], capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:17493")
    ap.add_argument("--voice")
    ap.add_argument("--draft", action="store_true", help="estimate timings, no audio")
    ap.add_argument("--all", action="store_true", help="re-render every scene, even ones whose words haven't changed")
    args = ap.parse_args()

    spec = json.loads((HERE / "narration.json").read_text())
    if args.draft:
        out_scenes = []
        for scene in spec["scenes"]:
            cues, t = [], 0.0
            for line in scene["lines"]:
                d = 0.35 + len(line.split()) / WPS
                cues.append({"start": round(t, 3), "end": round(t + d, 3), "text": line})
                t += d + GAP
            out_scenes.append({"id": scene["id"], "title": scene["title"], "track": scene.get("track"), "audio": None,
                               "duration": round(t, 3), "cues": cues})
        js = "// Draft timings estimated by build_voice.py --draft (no audio yet). Do not edit by hand.\n"
        js += "window.NARRATION = " + json.dumps({"voice": None, "draft": True, "tracks": spec.get("tracks"), "scenes": out_scenes}, indent=1) + ";\n"
        (HERE / "narration.js").write_text(js)
        print("draft total", round(sum(s["duration"] for s in out_scenes), 1), "s")
        return
    voice = args.voice or spec["voice"]
    profile = next(p for p in api(args.url, "GET", "/profiles") if p["name"].lower() == voice.lower())
    (HERE / "audio").mkdir(exist_ok=True)
    out_scenes = []
    # reuse a scene's audio when its words haven't changed since the last real render
    previous = {}
    old = HERE / "narration.js"
    if old.exists() and not args.all:
        txt = old.read_text()
        prev = json.loads(txt[txt.index("{"):txt.rindex("}") + 1])
        if not prev.get("draft") and prev.get("voice") == voice:
            previous = {s["id"]: s for s in prev["scenes"]}

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        silence = tmp / "gap.wav"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i",
                        "anullsrc=r=24000:cl=mono", "-t", str(GAP), str(silence)], check=True)
        for scene in spec["scenes"]:
            was = previous.get(scene["id"])
            if was and [c["text"] for c in was["cues"]] == scene["lines"] and (HERE / was["audio"]).exists():
                print(f"  {scene['id']}: unchanged, reusing audio")
                out_scenes.append({**was, "title": scene["title"], "track": scene.get("track")})
                continue
            say_map = scene.get("say", {})
            parts, cues, t = [], [], 0.0
            for i, line in enumerate(scene["lines"]):
                spoken = line
                for k in sorted(say_map, key=len, reverse=True):
                    spoken = spoken.replace(k, say_map[k])
                raw = tmp / f"{scene['id']}-{i}.wav"
                print(f"  {scene['id']} {i}: {spoken}")
                tts(args.url, profile, spoken, raw)
                norm = tmp / f"{scene['id']}-{i}-n.wav"
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw),
                                "-ar", "24000", "-ac", "1", str(norm)], check=True)
                d = duration(norm)
                cues.append({"start": round(t, 3), "end": round(t + d, 3), "text": line})
                parts += [norm, silence]
                t += d + GAP
            listfile = tmp / f"{scene['id']}.txt"
            listfile.write_text("".join(f"file '{p}'\n" for p in parts))
            mp3 = HERE / "audio" / f"{scene['id']}.mp3"
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
                            "-i", str(listfile), "-codec:a", "libmp3lame", "-q:a", "4", str(mp3)], check=True)
            out_scenes.append({"id": scene["id"], "title": scene["title"], "track": scene.get("track"), "audio": f"audio/{scene['id']}.mp3",
                               "duration": round(duration(mp3), 3), "cues": cues})

    js = "// Generated by build_voice.py from narration.json. Do not edit by hand.\n"
    js += "window.NARRATION = " + json.dumps({"voice": voice, "tracks": spec.get("tracks"), "scenes": out_scenes}, indent=1) + ";\n"
    (HERE / "narration.js").write_text(js)
    print("total", round(sum(s["duration"] for s in out_scenes), 1), "s")


if __name__ == "__main__":
    main()

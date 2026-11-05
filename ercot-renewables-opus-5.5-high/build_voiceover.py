#!/usr/bin/env python3
"""Build the optional voiceover for duck.html with a local Voicebox server.

Reads profiles.js, writes one narration clip per scene and season to
voiceover/<season>-<n>.webm (Opus, mono, VoIP profile) plus
voiceover/voiceover.js, which the page loads to time each scene.

The spoken numbers come from the same averages the page draws, so rerun
this after build_data.py.

Usage: python3 build_voiceover.py [--url http://127.0.0.1:17493] [--voice Heart]
Requires ffmpeg (with libopus) and ffprobe.
"""
import argparse
import json
import os
import re
import subprocess
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "voiceover")
SEASONS = {"spring": ("March, April and May", [2, 3, 4]), "summer": ("June, July and August", [5, 6, 7])}
HOURS = [(j + 1) / 4 for j in range(96)]  # interval ending, in hours


# ---------- data (mirrors duck.js) ----------

def load_profiles():
    with open(os.path.join(HERE, "profiles.js")) as f:
        src = f.read()
    return json.loads(src[src.index("=") + 1:].strip().rstrip(";"))


def average(P, y, months, key):
    idx = [P["months"].index(f"{y}-{m + 1:02d}") if f"{y}-{m + 1:02d}" in P["months"] else -1 for m in months]
    if min(idx) < 0:
        return None
    days = sum(P["days"][i] for i in idx)
    return [sum(P["series"][key][i][j] * P["days"][i] for i in idx) / days for j in range(96)]


def shape(v):
    lo = min(range(96), key=lambda j: v[j])
    hi = max(range(96), key=lambda j: v[j])
    # evening ramp: steepest 3-hour rise starting between noon and 9 pm
    j0 = max(range(47, 84), key=lambda j: v[j + 12] - v[j])
    return {"lo": lo, "hi": hi, "v": v, "ramp": v[j0 + 12] - v[j0]}


def season_stats(P, season):
    ms = SEASONS[season][1]
    years = sorted({int(m[:4]) for m in P["months"]})
    years = [y for y in years if average(P, y, ms, "demand")]
    out = {}
    for y in (years[0], years[-1]):
        p = {k: average(P, y, ms, k) for k in ("demand", "wind", "solar", "storage")}
        p["net"] = [d - w - s for d, w, s in zip(p["demand"], p["wind"], p["solar"])]
        p["res"] = [n - b for n, b in zip(p["net"], p["storage"])]
        out[y] = {k: shape(v) for k, v in p.items()}
    return years[0], years[-1], out


# ---------- spoken text ----------

def gw(mw):
    v = mw / 1000
    return f"{round(v)} gigawatts" if v >= 10 else f"{v:.1f} gigawatts".replace(".0 ", " ")


def num(mw):
    v = mw / 1000
    return str(round(v)) if v >= 10 else f"{v:.1f}".replace(".0", "")


def when(j):
    h = HOURS[j] % 24
    hh, mm = int(h), round((h % 1) * 60)
    t = f"{hh % 12 or 12}" + (f":{mm:02d}" if mm else "")
    if hh == 12 and not mm:
        return "noon"
    if hh == 0 and not mm:
        return "midnight"
    if hh < 5:
        return f"{t} in the morning" if hh >= 3 else f"{t} at night"
    if hh < 12:
        return f"{t} in the morning"
    if hh < 17:
        return f"{t} in the afternoon"
    if hh < 21:
        return f"{t} in the evening"
    return f"{t} at night"


def night(j):
    return HOURS[j] < 7 or HOURS[j] > 21


def script(P, season):
    months = SEASONS[season][0]
    y0, y1, S = season_stats(P, season)
    a, b = S[y0], S[y1]
    d, w, s, n = a["demand"], a["wind"], a["solar"], a["net"]
    lines = [
        f"This is an average {season} day on the Texas power grid in {y0}. "
        f"The line shows how much power the grid delivered, every fifteen minutes, averaged across {months}. "
        f"Demand bottoms out around {when(d['lo'])}, at about {gw(d['v'][d['lo']])}, "
        f"and peaks at about {gw(d['v'][d['hi']])} around {when(d['hi'])}.",

        f"Now take away wind. Wind farms supplied about {gw(sum(w['v']) / 96)} on an average day. "
        f"Texas wind blows hardest around {when(w['hi'])} and is weakest around {when(w['lo'])}, "
        f"so it covers the biggest slice of the night.",

        f"Then take away solar. Solar farms peaked at about {gw(s['v'][s['hi']])} around {when(s['hi'])}. "
        f"They make nothing before sunrise, and fade to zero in the evening, right as demand is near its peak.",

        f"What's left is called the net load. It's what gas, coal and nuclear plants have to supply. "
        f"In {y0}, it was lowest {'overnight' if night(n['lo']) else 'around ' + when(n['lo'])}, "
        f"and peaked at about {gw(n['v'][n['hi']])} around {when(n['hi'])}. "
        f"Its steepest afternoon or evening climb was about {gw(n['ramp'])} over three hours.",

        f"Now watch what happens as Texas builds solar, from {y0} to {y1}. "
        f"The {season} solar peak grows from about {num(s['v'][s['hi']])} to about {gw(b['solar']['v'][b['solar']['hi']])}. "
        + (f"The low point of the day moves from the middle of the night to {when(b['net']['lo'])}. "
           if night(n['lo']) and not night(b['net']['lo']) else
           f"The midday low sinks to about {gw(b['net']['v'][b['net']['lo']])}. ")
        + "That dip is the duck's belly. "
        f"Then, as the sun sets, other plants have to climb about {gw(b['net']['ramp'])} in just three hours. That's the neck. "
        f"It leads to an evening peak of about {gw(b['net']['v'][b['net']['hi']])}, the head. "
        "That shape is the duck curve.",

        f"Enter batteries. They charge on cheap daytime solar, taking in up to about {gw(-b['storage']['v'][b['storage']['lo']])} "
        f"around {when(b['storage']['lo'])}, and they discharge after sunset, up to about {gw(b['storage']['v'][b['storage']['hi']])} "
        f"around {when(b['storage']['hi'])}. Charging fills in the belly. Discharging cuts into the evening peak. "
        f"Back in {y0}, batteries barely registered.",

        f"The result is a flatter duck. With batteries, the evening climb shrinks from about {num(b['net']['ramp'])} "
        f"to about {gw(b['res']['ramp'])} in three hours, and the evening peak drops from about {num(b['net']['v'][b['net']['hi']])} "
        f"to about {gw(b['res']['v'][b['res']['hi']])}. Solar made the duck. Batteries are flattening it.",
    ]
    return lines


# ---------- voicebox ----------

def api(base, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        raw = r.read()
    return json.loads(raw) if raw else None


def speak(base, profile, text, wav):
    gen = api(base, "POST", "/generate", {
        "profile_id": profile["id"], "text": text,
        "language": profile.get("language") or "en",
        "engine": profile.get("default_engine") or profile.get("preset_engine") or "kokoro",
    })
    deadline = time.time() + 600
    while gen["status"] not in ("completed", "failed", "cancelled", "error"):
        if time.time() > deadline:
            raise TimeoutError("voicebox generation timed out")
        time.sleep(0.5)
        gen = api(base, "GET", f"/history/{gen['id']}")
    if gen["status"] != "completed":
        raise RuntimeError(gen.get("error") or gen["status"])
    urllib.request.urlretrieve(base + f"/audio/{gen['id']}", wav)
    api(base, "DELETE", f"/history/{gen['id']}")


def encode(wav, dest):
    # Opus, mono, VoIP application (tuned for speech); 24 kbps is transparent enough for narration
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-ac", "1",
                    "-c:a", "libopus", "-b:a", "24k", "-application", "voip", dest], check=True)
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", dest],
                         check=True, capture_output=True, text=True).stdout
    return round(float(out), 2)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="http://127.0.0.1:17493")
    ap.add_argument("--voice", default="Heart")
    args = ap.parse_args()
    base = args.url.rstrip("/")
    profile = next(p for p in api(base, "GET", "/profiles") if p["name"].lower() == args.voice.lower())

    P = load_profiles()
    os.makedirs(OUT, exist_ok=True)
    manifest = {"voice": profile["name"], "built": P["built"]}
    with tempfile.TemporaryDirectory() as tmp:
        for season in SEASONS:
            clips = []
            for k, text in enumerate(script(P, season)):
                text = re.sub(r"\s+", " ", text).strip()
                name = f"{season}-{k + 1}.webm"
                wav = os.path.join(tmp, "clip.wav")
                print(f"{name}: {text[:70]}...", flush=True)
                speak(base, profile, text, wav)
                clips.append({"file": "voiceover/" + name, "text": text, "duration": encode(wav, os.path.join(OUT, name))})
            manifest[season] = clips
    with open(os.path.join(OUT, "voiceover.js"), "w") as f:
        f.write("// Generated by build_voiceover.py with Voicebox. Do not edit.\n")
        f.write("window.DUCK_VOICEOVER = " + json.dumps(manifest, indent=1) + ";\n")
    print("wrote", os.path.join(OUT, "voiceover.js"))


if __name__ == "__main__":
    main()

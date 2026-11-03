#!/usr/bin/env python3
"""Generate one sample sentence per Voicebox voice profile and build an HTML comparison page.

Usage:
    python3 generate_samples.py [--text "..."] [--out DIR] [--url http://127.0.0.1:17493]

Requires ffmpeg on PATH for WAV -> MP3 conversion.
"""
import argparse
import html
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

DEFAULT_TEXT = (
    "The quick brown fox jumps over the lazy dog. "
    "Honestly, I wasn't expecting the results to sound this natural — what do you think?"
)
FALLBACK_ENGINE = "qwen"


def api(base, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method,
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        raw = r.read()
    return json.loads(raw) if raw else None


def download(base, path, dest):
    with urllib.request.urlopen(base + path, timeout=600) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "voice"


def generate(base, profile, text, timeout):
    engine = profile.get("default_engine") or profile.get("preset_engine") or FALLBACK_ENGINE
    gen = api(base, "POST", "/generate", {
        "profile_id": profile["id"],
        "text": text,
        "language": profile.get("language") or "en",
        "engine": engine,
    })
    deadline = time.time() + timeout
    while gen["status"] not in ("completed", "failed", "cancelled", "error"):
        if time.time() > deadline:
            raise TimeoutError(f"timed out after {timeout}s")
        time.sleep(1)
        gen = api(base, "GET", f"/history/{gen['id']}")
    if gen["status"] != "completed":
        raise RuntimeError(gen.get("error") or gen["status"])
    return gen, engine


def build_html(results, text, out_dir):
    by_engine = {}
    for r in results:
        by_engine.setdefault(r["engine"], []).append(r)

    sections = []
    for engine in sorted(by_engine):
        cards = []
        for r in sorted(by_engine[engine], key=lambda r: r["name"].lower()):
            meta = [r["voice_type"]]
            if r.get("preset_voice_id"):
                meta.append(r["preset_voice_id"])
            if r.get("duration"):
                meta.append(f'{r["duration"]:.1f}s')
            if r.get("error"):
                body = f'<p class="err">Failed: {html.escape(r["error"])}</p>'
            else:
                body = (f'<audio controls preload="none" src="{html.escape(r["file"])}"></audio>'
                        f'<a class="dl" href="{html.escape(r["file"])}" download>MP3</a>')
            cards.append(
                f'<div class="card"><div class="head"><h3>{html.escape(r["name"])}</h3>'
                f'<span class="meta">{html.escape(" · ".join(meta))}</span></div>'
                f'<div class="play">{body}</div></div>'
            )
        sections.append(f'<section><h2>{html.escape(engine)} <small>{len(cards)}</small></h2>'
                        f'<div class="grid">{"".join(cards)}</div></section>')

    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Voicebox Voice Samples</title>
<style>
:root {{ --bg:#f7f7f5; --card:#fff; --fg:#1d1d1b; --muted:#6b6b66; --line:#e3e3df; --accent:#3b5bdb; --err:#c92a2a; }}
@media (prefers-color-scheme: dark) {{
  :root {{ --bg:#161615; --card:#1f1f1d; --fg:#ececea; --muted:#9a9a94; --line:#2e2e2b; --accent:#7f9cf5; --err:#ff8787; }}
}}
* {{ box-sizing:border-box; }}
body {{ margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui,-apple-system,sans-serif; }}
main {{ max-width:1100px; margin:0 auto; padding:32px 16px 64px; }}
h1 {{ margin:0 0 4px; font-size:26px; }}
.sentence {{ color:var(--muted); margin:0 0 20px; font-style:italic; }}
.controls {{ display:flex; gap:8px; margin-bottom:28px; flex-wrap:wrap; }}
button {{ font:inherit; padding:6px 14px; border-radius:8px; border:1px solid var(--line); background:var(--card); color:var(--fg); cursor:pointer; }}
button:hover {{ border-color:var(--accent); }}
section {{ margin-bottom:32px; }}
h2 {{ font-size:14px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); border-bottom:1px solid var(--line); padding-bottom:6px; }}
h2 small {{ font-weight:400; }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:12px; }}
.card {{ background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px; }}
.card.playing {{ border-color:var(--accent); box-shadow:0 0 0 1px var(--accent); }}
.head {{ display:flex; justify-content:space-between; align-items:baseline; gap:8px; margin-bottom:8px; }}
h3 {{ margin:0; font-size:17px; }}
.meta {{ color:var(--muted); font-size:12px; text-align:right; }}
.play {{ display:flex; align-items:center; gap:8px; }}
audio {{ width:100%; height:36px; }}
.dl {{ font-size:12px; color:var(--accent); text-decoration:none; }}
.err {{ color:var(--err); margin:0; font-size:13px; }}
</style></head>
<body><main>
<h1>Voicebox Voice Samples</h1>
<p class="sentence">“{html.escape(text)}”</p>
<div class="controls"><button id="all">▶ Play all in sequence</button><button id="stop">■ Stop</button></div>
{"".join(sections)}
</main>
<script>
const players = [...document.querySelectorAll('audio')];
let queue = [];
players.forEach(a => {{
  a.addEventListener('play', () => {{
    players.forEach(o => {{ if (o !== a) o.pause(); }});
    document.querySelectorAll('.card').forEach(c => c.classList.remove('playing'));
    a.closest('.card').classList.add('playing');
  }});
  a.addEventListener('ended', () => {{
    a.closest('.card').classList.remove('playing');
    const next = queue.shift();
    if (next) next.play();
  }});
}});
document.getElementById('all').onclick = () => {{ queue = players.slice(1); players[0]?.play(); }};
document.getElementById('stop').onclick = () => {{ queue = []; players.forEach(a => a.pause()); }};
</script>
</body></html>
"""
    (out_dir / "index.html").write_text(page, encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="http://127.0.0.1:17493")
    ap.add_argument("--text", default=DEFAULT_TEXT)
    ap.add_argument("--out", default=str(Path(__file__).parent / "output"))
    ap.add_argument("--timeout", type=int, default=600, help="per-voice generation timeout (s)")
    ap.add_argument("--keep-history", action="store_true",
                    help="keep generations in Voicebox history (default: delete after download)")
    args = ap.parse_args()

    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg not found on PATH")
    base = args.url.rstrip("/")
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    profiles = api(base, "GET", "/profiles")
    print(f"{len(profiles)} voice profiles found")
    results, used = [], set()
    for i, p in enumerate(profiles, 1):
        name = slug(p["name"])
        while name in used:
            name += "-2"
        used.add(name)
        rec = {"name": p["name"], "voice_type": p.get("voice_type") or "",
               "preset_voice_id": p.get("preset_voice_id"), "file": f"{name}.mp3"}
        print(f"[{i}/{len(profiles)}] {p['name']} ...", end=" ", flush=True)
        start = time.time()
        try:
            gen, rec["engine"] = generate(base, p, args.text, args.timeout)
            wav = out_dir / f"{name}.wav"
            download(base, f"/audio/{gen['id']}", wav)
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav),
                            "-codec:a", "libmp3lame", "-q:a", "2", str(out_dir / rec["file"])], check=True)
            wav.unlink()
            rec["duration"] = gen.get("duration")
            if not args.keep_history:
                api(base, "DELETE", f"/history/{gen['id']}")
            print(f"ok ({time.time() - start:.1f}s)")
        except Exception as e:
            rec.setdefault("engine", p.get("default_engine") or FALLBACK_ENGINE)
            rec["error"] = str(e)
            print(f"FAILED: {e}")
        results.append(rec)

    build_html(results, args.text, out_dir)
    print(f"\nWrote {out_dir / 'index.html'}")


if __name__ == "__main__":
    main()

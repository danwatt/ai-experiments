#!/usr/bin/env python3
"""Compare emotional TTS engines (Orpheus, Qwen3-TTS CustomVoice 0.6B/1.7B, Chatterbox Turbo, VoxCPM2, Voxtral) on Apple Silicon via mlx-audio.

Every voice of every engine reads the same five lines; each engine gets the emotion cues in
its own dialect (inline tags for Orpheus/Chatterbox, a style instruction for Qwen3). Clips are
saved as MP3 with per-clip timings, and a combined HTML comparison page is written.

Setup:
    uv venv -p 3.12 .venv && uv pip install -p .venv/bin/python mlx-audio "misaki[en]"
Usage (page layout lives in page_template.html):
    .venv/bin/python tts_compare.py run [orpheus|qwen3_06b|qwen3_17b|chatterbox|voxcpm2_design|voxcpm2_clone|voxtral|all] [--force] [--only VOICE]
    .venv/bin/python tts_compare.py page

Chatterbox Turbo clones voices from refs/<kokoro_voice>.wav (8 Kokoro voices reading a neutral passage).
Requires ffmpeg on PATH. Existing MP3s are skipped unless --force.
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).parent
OUT = ROOT / "output"
REFS = ROOT / "refs"

# Per voice: (id, display name, gender, language/accent, note).
# Per engine: source = where voices come from, control = how emotion is cued, license = model weights.
KOKORO_VOICES = [("af_heart", "Heart", "F", "English · US", "Kokoro af_heart"),
                 ("af_bella", "Bella", "F", "English · US", "Kokoro af_bella"),
                 ("af_nicole", "Nicole", "F", "English · US", "Kokoro af_nicole, whispery"),
                 ("bf_emma", "Emma", "F", "English · UK", "Kokoro bf_emma"),
                 ("am_adam", "Adam", "M", "English · US", "Kokoro am_adam"),
                 ("am_michael", "Michael", "M", "English · US", "Kokoro am_michael"),
                 ("am_fenrir", "Fenrir", "M", "English · US", "Kokoro am_fenrir"),
                 ("bm_george", "George", "M", "English · UK", "Kokoro bm_george")]
QWEN3_VOICES = [("vivian", "Vivian", "F", "Chinese", ""), ("serena", "Serena", "F", "Chinese", ""),
                ("ono_anna", "Ono Anna", "F", "Japanese", ""), ("sohee", "Sohee", "F", "Korean", ""),
                ("ryan", "Ryan", "M", "English · unspecified", ""), ("aiden", "Aiden", "M", "English · US", ""),
                ("dylan", "Dylan", "M", "Chinese", "Beijing dialect"), ("eric", "Eric", "M", "Chinese", "Sichuan dialect"),
                ("uncle_fu", "Uncle Fu", "M", "Chinese", "")]

ENGINES = {
    "orpheus": {
        "label": "Orpheus", "model": "mlx-community/orpheus-3b-0.1-ft-bf16", "params": "3B",
        "source": "builtin", "control": "tags", "license": "Apache-2.0 (Llama 3.2 base)", "commercial": True,
        "emotion": "Inline tags: <laugh> <chuckle> <sigh> <groan> <gasp> <sniffle> <yawn> <cough>",
        "voices": [("tara", "Tara", "F", "English · US", ""), ("leah", "Leah", "F", "English · US", ""),
                   ("jess", "Jess", "F", "English · US", ""), ("mia", "Mia", "F", "English · US", ""),
                   ("zoe", "Zoe", "F", "English · US", ""), ("leo", "Leo", "M", "English · US", ""),
                   ("dan", "Dan", "M", "English · US", ""), ("zac", "Zac", "M", "English · US", "")],
    },
    "qwen3_06b": {
        "label": "Qwen3-TTS 0.6B", "model": "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16", "params": "0.6B",
        "source": "builtin", "control": "none", "license": "Apache-2.0", "commercial": True,
        "emotion": "None: 0.6B ignores style instructions (tags stripped)",
        "instruct": False, "voices": QWEN3_VOICES,
    },
    "qwen3_17b": {
        "label": "Qwen3-TTS 1.7B", "model": "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16", "params": "1.7B",
        "source": "builtin", "control": "instruct", "license": "Apache-2.0", "commercial": True,
        "emotion": "Natural-language style instruction per line (tags stripped)",
        "instruct": True, "voices": QWEN3_VOICES,
    },
    "chatterbox": {
        "label": "Chatterbox Turbo", "model": "mlx-community/chatterbox-turbo-fp16", "params": "350M",
        "source": "cloned", "control": "tags", "license": "MIT", "commercial": True,
        "emotion": "Inline tags: [laugh] [chuckle] [sigh] [groan] [gasp] [sniff] [cough] (no yawn)",
        "voices": KOKORO_VOICES,
    },
    "voxcpm2_design": {
        "label": "VoxCPM2 designed", "model": "mlx-community/VoxCPM2-8bit", "params": "2B (8-bit)",
        "source": "designed", "control": "instruct", "license": "Apache-2.0", "commercial": True,
        "emotion": "Voice description + style instruction per line (tags stripped)",
        "instruct": True,
        "voices": [("nora", "Nora", "F", "English · unspecified", ""), ("jade", "Jade", "F", "English · unspecified", ""),
                   ("edith", "Edith", "F", "English · unspecified", ""), ("lucy", "Lucy", "F", "English · US", "Southern"),
                   ("walter", "Walter", "M", "English · unspecified", ""), ("kai", "Kai", "M", "English · US", "Californian"),
                   ("nigel", "Nigel", "M", "English · UK", ""), ("hank", "Hank", "M", "English · unspecified", "")],
    },
    "voxcpm2_clone": {
        "label": "VoxCPM2 cloned", "model": "mlx-community/VoxCPM2-8bit", "params": "2B (8-bit)",
        "source": "cloned", "control": "instruct", "license": "Apache-2.0", "commercial": True,
        "emotion": "Style instruction per line on a cloned voice (tags stripped)",
        "instruct": True, "voices": KOKORO_VOICES,
    },
    "voxtral": {
        "label": "Voxtral TTS", "model": "mlx-community/Voxtral-4B-TTS-2603-mlx-bf16", "params": "4B",
        "source": "builtin", "control": "sounds", "license": "CC-BY-NC", "commercial": False,
        "emotion": "None built in: tags replaced with written-out sounds (\"ha ha\", \"Oh!\"); style comes from the preset",
        "voices": [("casual_female", "Cara", "F", "English · unspecified", "casual preset"),
                   ("cheerful_female", "Chloe", "F", "English · unspecified", "cheerful preset"),
                   ("neutral_female", "Nina", "F", "English · unspecified", "neutral preset"),
                   ("casual_male", "Max", "M", "English · unspecified", "casual preset"),
                   ("neutral_male", "Nate", "M", "English · unspecified", "neutral preset"),
                   ("fr_female", "Camille", "F", "French", ""), ("fr_male", "Louis", "M", "French", ""),
                   ("es_female", "Lucia", "F", "Spanish", ""), ("es_male", "Diego", "M", "Spanish", ""),
                   ("de_female", "Lena", "F", "German", ""), ("de_male", "Jonas", "M", "German", ""),
                   ("it_female", "Giulia", "F", "Italian", ""), ("it_male", "Marco", "M", "Italian", ""),
                   ("pt_female", "Beatriz", "F", "Portuguese", ""), ("pt_male", "Joao", "M", "Portuguese", ""),
                   ("nl_female", "Sanne", "F", "Dutch", ""), ("nl_male", "Daan", "M", "Dutch", ""),
                   ("hi_female", "Priya", "F", "Hindi", ""), ("hi_male", "Arjun", "M", "Hindi", ""),
                   ("ar_male", "Omar", "M", "Arabic", "")],
    },
}

# Text descriptions for VoxCPM2 voice design (shown as chip tooltips on the page)
VOICE_DESIGNS = {
    "nora": "A young woman with a warm, gentle voice",
    "jade": "An energetic young female podcast host, bright and fast-paced",
    "edith": "An elderly woman, soft and slightly raspy, kind and unhurried",
    "lucy": "A woman in her thirties with a friendly Southern American accent",
    "walter": "A middle-aged male news anchor, deep and authoritative",
    "kai": "A laid-back young man with a relaxed California surfer accent",
    "nigel": "A British male professor, crisp and articulate",
    "hank": "An older man with a low, gravelly voice",
}

# (key, label, text with Orpheus-style tags, Qwen3 style instruction)
LINES = [
    ("plain", "Baseline (no emotion cues)",
     "Hi, I'm {Name}. This is what I sound like reading a plain sentence, with no emotion tags at all.",
     None),
    ("laugh", "Laughing",
     "So then he tried to parallel park the moving truck <laugh> and took out the mailbox. <chuckle> Twice.",
     "Amused, laughing while telling a funny story, breaking into a chuckle at the end."),
    ("sigh", "Weary",
     "<sigh> It's Monday again. The coffee machine is broken, <groan> and I have six meetings before lunch.",
     "Tired and exasperated, sighing heavily and groaning."),
    ("gasp", "Surprised, touched",
     "<gasp> Wait, you remembered my birthday? <sniffle> Nobody ever remembers. This is so sweet.",
     "Gasping in surprise, then touched and tearful, voice trembling with emotion."),
    ("yawn", "Sleepy",
     "<yawn> Sorry, it's been a really long night. <cough> Excuse me. Okay, where were we?",
     "Sleepy and groggy, yawning, then clearing the throat."),
]

CHATTERBOX_TAGS = {"laugh": "[laugh]", "chuckle": "[chuckle]", "sigh": "[sigh]", "groan": "[groan]",
                   "gasp": "[gasp]", "sniffle": "[sniff]", "cough": "[cough]", "yawn": ""}


# Voxtral strips <tags> and reads [tags] aloud, so cues become written-out sounds
VOXTRAL_SOUNDS = {"laugh": ", ha ha,", "chuckle": "Heh.", "sigh": "Haaah.", "groan": "ugh,",
                  "gasp": "Oh!", "sniffle": "", "yawn": "Mmmh, aaah.", "cough": "Ahem."}


def line_text(engine, template, name):
    text = template.replace("{Name}", name)
    if engine == "chatterbox":
        text = re.sub(r"<(\w+)>", lambda m: CHATTERBOX_TAGS.get(m.group(1), ""), text)
    elif engine == "voxtral":
        text = re.sub(r"\s*,", ",", re.sub(r"<(\w+)>", lambda m: VOXTRAL_SOUNDS.get(m.group(1), ""), text))
    elif engine.startswith(("qwen3", "voxcpm2")):
        text = re.sub(r"<\w+>", "", text)
    return re.sub(r"\s{2,}", " ", text).strip()


def instruct_for(engine, voice, instruct):
    """The exact style/voice instruction an engine receives for a line (None if it takes none)."""
    if engine == "voxcpm2_design":
        style = f", {instruct[0].lower()}{instruct[1:].rstrip('.')}" if instruct else ""
        return VOICE_DESIGNS[voice] + style
    return instruct if ENGINES[engine].get("instruct") else None


# ---------- generation ----------

def encode_mp3(audio, sample_rate, dest):
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "f32le", "-ar", str(sample_rate), "-ac", "1",
         "-i", "-", "-codec:a", "libmp3lame", "-q:a", "2", str(dest)],
        input=audio.astype("float32").tobytes(), check=True,
    )


def synthesize(engine, model, voice, text, instruct):
    import numpy as np
    instruct = instruct_for(engine, voice, instruct)
    if engine == "orpheus":
        results = model.generate(text=text, voice=voice, temperature=0.6, top_p=0.8,
                                 repetition_penalty=1.1, verbose=False)
    elif engine.startswith("qwen3"):
        results = model.generate_custom_voice(text=text, speaker=voice, language="English", instruct=instruct)
    elif engine == "voxcpm2_design":
        results = model.generate(text=text, instruct=instruct)
    elif engine == "voxcpm2_clone":
        results = model.generate(text=text, ref_audio=str(REFS / f"{voice}.wav"), instruct=instruct)
    elif engine == "voxtral":
        results = model.generate(text=text, voice=voice)
    else:
        results = model.generate(text=text, ref_audio=str(REFS / f"{voice}.wav"))
    chunks, sr = [], 24000
    for r in results:
        chunks.append(np.array(r.audio).reshape(-1))
        sr = r.sample_rate
    return np.concatenate(chunks), sr


def run_engine(engine, force, only, seed):
    import mlx.core as mx
    from mlx_audio.tts.utils import load_model

    cfg = ENGINES[engine]
    out = OUT / engine
    out.mkdir(parents=True, exist_ok=True)
    tpath = out / "timings.json"
    timings = json.loads(tpath.read_text()) if tpath.exists() else {"clips": {}}

    voices = [v for v in cfg["voices"] if not only or v[0] in only]
    jobs = [(v, k, t, ins) for v in voices for k, _, t, ins in LINES
            if force or not (out / f"{v[0]}-{k}.mp3").exists()]
    if not jobs:
        print(f"{engine}: nothing to do")
        return

    print(f"{engine}: loading {cfg['model']} ...", flush=True)
    start = time.time()
    model = load_model(cfg["model"])
    timings["load_s"] = round(time.time() - start, 1)
    print(f"{engine}: loaded in {timings['load_s']}s")

    for i, ((vid, vname, *_), key, template, instruct) in enumerate(jobs, 1):
        print(f"[{engine} {i}/{len(jobs)}] {vid} / {key} ...", end=" ", flush=True)
        mx.random.seed(seed)
        start = time.time()
        try:
            audio, sr = synthesize(engine, model, vid, line_text(engine, template, vname), instruct)
            gen_s = time.time() - start
            encode_mp3(audio, sr, out / f"{vid}-{key}.mp3")
            timings["clips"][f"{vid}-{key}"] = {"audio_s": round(len(audio) / sr, 2), "gen_s": round(gen_s, 2)}
            tpath.write_text(json.dumps(timings, indent=1))
            print(f"ok ({len(audio) / sr:.1f}s audio in {gen_s:.1f}s)")
        except Exception as e:
            print(f"FAILED: {e}")
        mx.clear_cache()

    del model
    mx.clear_cache()


# ---------- page ----------

SOURCE_LABELS = {"builtin": "Built-in preset", "cloned": "Cloned from Kokoro clip", "designed": "Designed from text"}
CONTROL_LABELS = {"tags": "Inline tags", "instruct": "Style instruction", "sounds": "Written-out sounds",
                  "none": "None"}
SPEED_LABELS = {"fast": "Fast (< 0.5× real time)", "medium": "Medium (0.5–1.5×)", "slow": "Slow (> 1.5×)"}


def build_page():
    engines, clips = {}, []
    for engine, cfg in ENGINES.items():
        tpath = OUT / engine / "timings.json"
        timings = json.loads(tpath.read_text())["clips"] if tpath.exists() else {}
        gen = sum(c["gen_s"] for c in timings.values())
        aud = sum(c["audio_s"] for c in timings.values())
        rtf = gen / aud if aud else 0
        speed = "fast" if rtf < 0.5 else "medium" if rtf < 1.5 else "slow"
        engines[engine] = {
            "label": cfg["label"], "model": cfg["model"], "params": cfg["params"], "emotion": cfg["emotion"],
            "license": cfg["license"], "voices": len(cfg["voices"]), "clips": len(timings),
            "avg_gen": round(gen / len(timings), 1) if timings else None, "rtf": round(rtf, 2),
        }
        for vid, vname, gender, lang, note in cfg["voices"]:
            if engine == "voxcpm2_design":
                note = VOICE_DESIGNS[vid]
            for key, _, template, instruct in LINES:
                t = timings.get(f"{vid}-{key}")
                src = f"{engine}/{vid}-{key}.mp3"
                if not t or not (OUT / src).exists():
                    continue
                clips.append({
                    "e": engine, "voice": f"{engine}/{vid}", "name": vname, "gender": gender, "lang": lang,
                    "note": note, "line": key, "src": src, "audio_s": t["audio_s"], "gen_s": t["gen_s"],
                    "text": line_text(engine, template, vname), "instruct": instruct_for(engine, vid, instruct),
                    "source": cfg["source"], "control": cfg["control"], "speed": speed,
                    "license": "commercial" if cfg["commercial"] else "noncommercial",
                })

    langs = sorted({c["lang"] for c in clips}, key=lambda l: (not l.startswith("English"), l))
    facets = [
        {"key": "line", "label": "Emotion", "values": [[k, label] for k, label, *_ in LINES]},
        {"key": "e", "label": "Engine", "values": [[k, e["label"]] for k, e in engines.items()]},
        {"key": "gender", "label": "Gender", "values": [["F", "Female"], ["M", "Male"]]},
        {"key": "lang", "label": "Language / accent", "values": [[l, l] for l in langs]},
        {"key": "source", "label": "Voice source", "values": [[k, v] for k, v in SOURCE_LABELS.items()]},
        {"key": "control", "label": "Emotion control", "values": [[k, v] for k, v in CONTROL_LABELS.items()]},
        {"key": "speed", "label": "Speed", "values": [[k, v] for k, v in SPEED_LABELS.items()]},
        {"key": "license", "label": "License", "values": [["commercial", "Commercial use OK"],
                                                           ["noncommercial", "Non-commercial only"]]},
    ]
    data = {"engines": engines, "facets": facets, "clips": clips}
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    page = (ROOT / "page_template.html").read_text(encoding="utf-8").replace("/*__DATA__*/null", payload)
    (OUT / "index.html").write_text(page, encoding="utf-8")
    print(f"Wrote {OUT / 'index.html'} ({len(clips)} clips)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    run = sub.add_parser("run")
    run.add_argument("engine", choices=[*ENGINES, "all"])
    run.add_argument("--force", action="store_true", help="regenerate existing MP3s")
    run.add_argument("--only", nargs="+", help="limit to these voice ids")
    run.add_argument("--seed", type=int, default=42)
    sub.add_parser("page")
    args = ap.parse_args()

    if args.cmd == "run":
        if not shutil.which("ffmpeg"):
            sys.exit("ffmpeg not found on PATH")
        for engine in (ENGINES if args.engine == "all" else [args.engine]):
            run_engine(engine, args.force, args.only, args.seed)
    build_page()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Build a demo page for a Claude design system exported into a directory.

  python3 scripts/build-design-demo.py <dir>

<dir> holds the files exported from the design system artifact:
  tokens.json                      colors per theme, type, spacing, radius, shadow, ...
  README.md                        brand guidance
  components/bundle.css            component rules, on var(--token)
  components/bundle.js             optional, React components (set "react": true)
  components/<Name>/preview.html   one live card per component
  components/<Name>/README.md      optional usage notes
  demo.json                        page config (title, tagline, fonts, theme list, ...)

Writes:
  dist/tokens.css                  every token as a custom property, themed
  index.html                       specimen page: colors, type, scales, component cards
"""
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else None
if ROOT is None or not (ROOT / "tokens.json").exists():
    sys.exit(__doc__)

tokens = json.loads((ROOT / "tokens.json").read_text())
cfg = json.loads((ROOT / "demo.json").read_text())
THEMES = [t["id"] for t in tokens["color"]["themes"]]
FAMILIES = tokens["type"]["families"]
BODY_FONT = cfg.get("bodyFont") or next(iter(FAMILIES))
HEAD_FONT = cfg.get("headFont") or BODY_FONT
ALIAS = re.compile(r"^\{([A-Za-z0-9_.-]+)\}$")
esc = html.escape


def css_value(v):
    v = str(v)
    m = ALIAS.match(v)
    return f"var(--{m.group(1)})" if m else v


# ── tokens.css ────────────────────────────────────────────────────────────

def themed_decls(family_tokens, theme_id, first):
    out = []
    for t in family_tokens:
        v = t["value"]
        if isinstance(v, dict):
            if theme_id in v:
                out.append((t["name"], css_value(v[theme_id])))
        elif first:
            out.append((t["name"], css_value(v)))
    return out


def decls(pairs, indent="  "):
    return "\n".join(f"{indent}--{n}: {v};" for n, v in pairs)


def build_tokens_css():
    first = THEMES[0]
    lines = [f"/* {tokens['name']} tokens — generated from tokens.json by scripts/build-design-demo.py. Do not edit by hand. */", ""]
    base = themed_decls(tokens["color"]["tokens"], first, True) + themed_decls(tokens.get("shadow", {"tokens": []})["tokens"], first, True)
    for fam in ("spacing", "radius", "layout", "opacity", "zIndex"):
        if fam in tokens:
            base += [(t["name"], css_value(t["value"])) for t in tokens[fam]["tokens"]]
    base += [(f"font-{k}", v) for k, v in FAMILIES.items()]
    lines += [f':root, [data-theme="{first}"] {{', decls(base), f"  color-scheme: {first};", "}"]
    for tid in THEMES[1:]:
        extra = themed_decls(tokens["color"]["tokens"], tid, False) + themed_decls(tokens.get("shadow", {"tokens": []})["tokens"], tid, False)
        lines += ["", f'[data-theme="{tid}"] {{', decls(extra), f"  color-scheme: {tid};", "}"]
    css = "\n".join(lines) + "\n"
    (ROOT / "dist").mkdir(exist_ok=True)
    (ROOT / "dist" / "tokens.css").write_text(css)
    return css


tokens_css = build_tokens_css()

# every var(--x) the component sheet uses must be defined
defined = set(re.findall(r"--([A-Za-z0-9-]+)\s*:", tokens_css))
used = set(re.findall(r"var\(--([A-Za-z0-9-]+)", (ROOT / "components" / "bundle.css").read_text()))
missing = sorted(used - defined)
if missing:
    print("warning: bundle.css uses undefined tokens:", ", ".join(missing))

# ── tiny markdown ─────────────────────────────────────────────────────────

def inline_md(s):
    s = esc(s, quote=False)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', s)
    return s


def md(text):
    out, para, items = [], [], []

    def flush():
        nonlocal para, items
        if para:
            out.append("<p>" + inline_md(" ".join(para)) + "</p>")
        if items:
            out.append("<ul>" + "".join(f"<li>{inline_md(i)}</li>" for i in items) + "</ul>")
        para, items = [], []

    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip():
            flush()
        elif line.startswith("#"):
            flush()
            out.append("<h4>" + inline_md(line.lstrip("# ").strip()) + "</h4>")
        elif re.match(r"^\s*[-*] ", line):
            if para:
                flush()
            items.append(re.sub(r"^\s*[-*] ", "", line))
        elif items and line.startswith("  "):
            items[-1] += " " + line.strip()
        else:
            if items:
                flush()
            para.append(line.strip())
    flush()
    return "\n".join(out)


# ── previews ──────────────────────────────────────────────────────────────

REACT = (
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>'
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>'
)
PAD = cfg.get("previewPad", "0")
P = cfg["page"]


def parse_card(src):
    m = re.match(r"\s*<!--\s*@dsCard(.*?)-->", src, re.S)
    meta = {}
    if m:
        for k, quoted, bare in re.findall(r'(\w+)=(?:"([^"]*)"|(\S+))', m.group(1)):
            meta[k] = quoted or bare
        src = src[m.end():]
    return meta, src


def wrap_preview(src, extra_css=""):
    fonts = f'<link rel="stylesheet" href="{cfg["fonts"]}">' if cfg.get("fonts") else ""
    head = (
        '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
        f"{fonts}"
        '<link rel="stylesheet" href="dist/tokens.css"><link rel="stylesheet" href="components/bundle.css">'
        f"<style>html,body{{margin:0}}body{{background:var(--{P['bg']});color:var(--{P['ink']});font-family:var(--font-{BODY_FONT});padding:{PAD}}}{extra_css}</style>"
    )
    if cfg.get("react"):
        head += REACT
    tail = ""
    if cfg.get("react") and (ROOT / "components" / "bundle.js").exists():
        head += '<script src="components/bundle.js"></script>'
    if re.search(r"<html", src, re.I):
        return re.sub(r"(<html[^>]*>)", lambda m: m.group(1) + "<head>" + head + "</head>", src, count=1, flags=re.I)
    return f"<!doctype html><html><head>{head}</head><body>{src}{tail}</body></html>"


components = []
for d in sorted((ROOT / "components").iterdir()):
    pv = d / "preview.html"
    if not d.is_dir() or not pv.exists():
        continue
    meta, body = parse_card(pv.read_text())
    readme = (d / "README.md").read_text() if (d / "README.md").exists() else ""
    components.append({"name": d.name, "meta": meta, "src": body, "readme": readme})

cover = next((c for c in components if c["name"] == "Cover"), None)
cards = [c for c in components if c["name"] != "Cover"]
cards.sort(key=lambda c: (c["meta"].get("group", "zzz"), c["name"]))

# ── sections ──────────────────────────────────────────────────────────────

def hexes(v):
    if isinstance(v, dict):
        return " · ".join(f"{k} {x}" for k, x in v.items())
    return str(v)


def section_colors():
    out = []
    for t in tokens["color"]["tokens"]:
        out.append(
            f'<div class="sw" data-name="{esc(t["name"])}"><div class="sw__chip" style="background:var(--{t["name"]})"></div>'
            f'<div class="sw__body"><code class="sw__name">{esc(t["name"])}</code>'
            f'<span class="sw__hex">{esc(hexes(t["value"]))}</span>'
            f'<span class="sw__use">{inline_md(t.get("usage", ""))}</span></div></div>'
        )
    return '<div class="swatches" id="swatches">' + "".join(out) + "</div>"


def section_type():
    out = []
    for g in tokens["type"]["groups"]:
        out.append(f'<h3>{esc(g["name"])} <small>{esc(g["family"])}</small></h3><div class="specimens">')
        for st in g["styles"]:
            fam = st.get("family", g["family"])
            style = f"font-family:var(--font-{fam});font-size:{st['fontSize']};line-height:{st['lineHeight']};font-weight:{st['fontWeight']}"
            if "letterSpacing" in st:
                style += f";letter-spacing:{st['letterSpacing']}"
            sample = st.get("sample") or "Sphinx of black quartz, judge my vow"
            lh = st["lineHeight"]
            out.append(
                f'<div class="spec"><div class="spec__meta"><code>{esc(st["name"])}</code>'
                f'<span>{esc(st["fontSize"])} / {esc(str(lh))} · {st["fontWeight"]}</span></div>'
                f'<div class="spec__sample" style="{style}">{esc(sample)}</div>'
                f'<div class="spec__use">{inline_md(st.get("usage", ""))}</div></div>'
            )
        out.append("</div>")
    return "".join(out)


def scale_rows(fam, render):
    if fam not in tokens:
        return ""
    note = tokens[fam].get("note", "")
    rows = "".join(
        f'<tr><td><code>{esc(t["name"])}</code></td><td class="num">{esc(str(t["value"]))}</td><td class="viz">{render(t)}</td><td class="use">{inline_md(t.get("usage", ""))}</td></tr>'
        for t in tokens[fam]["tokens"]
    )
    n = f'<p class="note">{inline_md(note)}</p>' if note else ""
    return f'{n}<div class="tablewrap"><table class="scale"><tbody>{rows}</tbody></table></div>'


def num_px(v):
    m = re.match(r"^(-?[\d.]+)px$", str(v))
    return float(m.group(1)) if m else None


def viz_space(t):
    px = num_px(t["value"])
    return f'<span class="bar" style="width:{min(px, 240)}px"></span>' if px else ""


def viz_radius(t):
    return f'<span class="box" style="border-radius:var(--{t["name"]})"></span>'


def viz_shadow(t):
    return f'<span class="box box--shadow" style="box-shadow:var(--{t["name"]})"></span>'


def viz_layout(t):
    px = num_px(t["value"])
    return f'<span class="bar bar--thin" style="width:{min(px, 240)}px"></span>' if px else ""


def viz_opacity(t):
    return f'<span class="box" style="opacity:var(--{t["name"]});background:var(--{P["accent"]})"></span>'


def section_components():
    out, group = [], None
    for c in cards:
        g = c["meta"].get("group") or "Components"
        if g != group:
            if group is not None:
                out.append("</div>")
            out.append(f'<h3 class="group">{esc(g)}</h3><div class="cards">')
            group = g
        height = c["meta"].get("height", "160")
        sub = c["meta"].get("subtitle", "")
        doc = wrap_preview(c["src"])
        readme = f'<details class="guide"><summary>Usage guidelines</summary>{md(c["readme"])}</details>' if c["readme"] else ""
        out.append(
            f'<article class="card" id="c-{esc(c["name"])}"><header><h4>{esc(c["name"])}</h4><span>{esc(sub)}</span></header>'
            f'<iframe class="fit" title="{esc(c["name"])} preview" loading="lazy" style="height:{height}px" srcdoc="{esc(doc, quote=True)}"></iframe>{readme}</article>'
        )
    if group is not None:
        out.append("</div>")
    return "".join(out)


sections = [("colors", "Colors", section_colors(), f'<input id="filter" type="search" placeholder="Filter {len(tokens["color"]["tokens"])} colors" aria-label="Filter colors">'),
            ("type", "Type", section_type(), "")]
for fam, title, fn in (("spacing", "Spacing", viz_space), ("radius", "Radius", viz_radius), ("shadow", "Shadow", viz_shadow),
                       ("layout", "Layout", viz_layout), ("opacity", "Opacity", viz_opacity), ("zIndex", "Z-index", lambda t: "")):
    if fam in tokens:
        sections.append((fam.lower(), title, scale_rows(fam, fn), ""))
sections.append(("components", "Components", section_components(), ""))

nav = "".join(f'<a href="#{i}">{esc(t)}</a>' for i, t, _, _ in sections)
body_sections = "".join(
    f'<section id="{i}"><div class="sechead"><h2>{esc(t)}</h2>{extra}</div>{content}</section>' for i, t, content, extra in sections
)

cover_html = ""
if cover:
    doc = wrap_preview(cover["src"], "body{padding:0!important;overflow:hidden}")
    cover_html = (
        f'<div class="cover" id="cover"><iframe title="Cover" tabindex="-1" style="width:960px;height:{cover["meta"].get("height", 288)}px" '
        f'srcdoc="{esc(doc, quote=True)}"></iframe></div>'
    )

theme_seg = ""
if len(THEMES) > 1:
    theme_seg = '<div class="seg" role="group" aria-label="Theme">' + "".join(
        f'<button type="button" data-theme-choice="{t}" aria-pressed="{"true" if i == 0 else "false"}">{t.capitalize()}</button>' for i, t in enumerate(THEMES)
    ) + "</div>"

fonts_link = f'<link rel="stylesheet" href="{cfg["fonts"]}">' if cfg.get("fonts") else ""
alt_note = f' (named “{esc(cfg["artifactName"])}” there)' if cfg.get("artifactName") else ""

page = f"""<!doctype html>
<html lang="en" data-theme="{THEMES[0]}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(cfg["title"])} design system</title>
<meta name="description" content="{esc(cfg["tagline"])}">
{fonts_link}
<link rel="stylesheet" href="dist/tokens.css">
<link rel="stylesheet" href="components/bundle.css">
<style>
  /* Page chrome only. Colors, type and spacing come from this system's own tokens. */
  *, *::before, *::after {{ box-sizing: border-box; }}
  html {{ scroll-behavior: smooth; }}
  body {{ margin: 0; background: var(--{P["bg"]}); color: var(--{P["ink"]}); font-family: var(--font-{BODY_FONT}); font-size: 14px; line-height: 1.55; -webkit-font-smoothing: antialiased; }}
  a {{ color: var(--{P["accent"]}); }}
  code {{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .92em; color: var(--{P["accent"]}); }}
  .wrap {{ max-width: 1120px; margin: 0 auto; padding: 24px max(16px, env(safe-area-inset-right, 0px)) 96px max(16px, env(safe-area-inset-left, 0px)); }}
  .topbar {{ display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }}
  .topbar a {{ font-weight: 600; text-decoration: none; }}
  .seg {{ display: inline-flex; border: 1px solid var(--{P["line"]}); border-radius: 4px; overflow: hidden; }}
  .seg button {{ appearance: none; border: 0; background: var(--{P["surface"]}); color: var(--{P["muted"]}); font: inherit; font-size: 12px; padding: 5px 12px; cursor: pointer; }}
  .seg button + button {{ border-left: 1px solid var(--{P["line"]}); }}
  .seg button[aria-pressed="true"] {{ background: var(--{P["accentFill"]}); color: var(--{P["onAccent"]}); }}
  .hero {{ margin-top: 40px; }}
  .eyebrow {{ margin: 0 0 8px; color: var(--{P["muted"]}); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; font-family: var(--font-{HEAD_FONT}); }}
  h1 {{ margin: 0; font-family: var(--font-{HEAD_FONT}); font-size: clamp(30px, 6vw, 52px); line-height: 1.1; font-weight: 700; }}
  .lead {{ max-width: 70ch; color: var(--{P["muted"]}); font-size: 15px; margin: 16px 0 0; }}
  .links {{ display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }}
  .links a {{ border: 1px solid var(--{P["line"]}); border-radius: 4px; padding: 6px 12px; text-decoration: none; background: var(--{P["surface"]}); font-weight: 600; font-size: 13px; }}
  .cover {{ position: relative; margin-top: 32px; border: 1px solid var(--{P["line"]}); border-radius: 6px; overflow: hidden; }}
  .cover iframe {{ border: 0; display: block; transform-origin: 0 0; }}
  nav.sections {{ position: sticky; top: 0; z-index: 5; display: flex; gap: 4px; flex-wrap: wrap; margin: 32px -16px 0; padding: 10px 16px; background: var(--{P["bg"]}); border-bottom: 1px solid var(--{P["line"]}); }}
  nav.sections a {{ padding: 4px 10px; border-radius: 4px; text-decoration: none; color: var(--{P["muted"]}); font-weight: 600; font-size: 13px; }}
  nav.sections a:hover {{ background: var(--{P["surface"]}); color: var(--{P["ink"]}); }}
  section {{ margin-top: 56px; scroll-margin-top: 60px; }}
  .sechead {{ display: flex; justify-content: space-between; align-items: end; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }}
  h2 {{ margin: 0; font-family: var(--font-{HEAD_FONT}); font-size: 22px; font-weight: 700; }}
  h3 {{ margin: 32px 0 12px; font-size: 15px; font-weight: 700; }}
  h3 small {{ color: var(--{P["muted"]}); font-weight: 400; margin-left: 6px; }}
  h4 {{ margin: 0; font-size: 14px; }}
  .note {{ color: var(--{P["muted"]}); max-width: 80ch; margin: 0 0 12px; }}
  #filter {{ font: inherit; font-size: 13px; padding: 6px 10px; border-radius: 4px; border: 1px solid var(--{P["line"]}); background: var(--{P["surface"]}); color: var(--{P["ink"]}); width: 240px; max-width: 100%; }}

  .swatches {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }}
  .sw {{ border: 1px solid var(--{P["line"]}); border-radius: 6px; background: var(--{P["surface"]}); overflow: hidden; min-width: 0; }}
  .sw[hidden] {{ display: none; }}
  .sw__chip {{ height: 56px; border-bottom: 1px solid var(--{P["line"]}); }}
  .sw__body {{ padding: 10px 12px 12px; display: grid; gap: 2px; }}
  .sw__name {{ font-weight: 600; color: var(--{P["ink"]}); }}
  .sw__hex {{ font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: var(--{P["muted"]}); overflow-wrap: anywhere; }}
  .sw__use {{ font-size: 12px; color: var(--{P["muted"]}); margin-top: 4px; }}

  .specimens {{ display: grid; gap: 1px; background: var(--{P["line"]}); border: 1px solid var(--{P["line"]}); border-radius: 6px; overflow: hidden; }}
  .spec {{ background: var(--{P["surface"]}); padding: 14px 16px; display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 4px 20px; align-items: baseline; }}
  .spec__meta {{ display: grid; gap: 2px; font-size: 12px; color: var(--{P["muted"]}); }}
  .spec__sample {{ color: var(--{P["ink"]}); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }}
  .spec__use {{ grid-column: 2; font-size: 12px; color: var(--{P["muted"]}); }}
  @media (max-width: 640px) {{ .spec {{ grid-template-columns: 1fr; }} .spec__use {{ grid-column: 1; }} }}

  .tablewrap {{ overflow-x: auto; border: 1px solid var(--{P["line"]}); border-radius: 6px; background: var(--{P["surface"]}); }}
  table.scale {{ width: 100%; border-collapse: collapse; }}
  table.scale td {{ padding: 10px 14px; border-top: 1px solid var(--{P["line"]}); vertical-align: middle; }}
  table.scale tr:first-child td {{ border-top: 0; }}
  td.num {{ font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: var(--{P["muted"]}); white-space: nowrap; max-width: 280px; overflow-wrap: anywhere; white-space: normal; }}
  td.use {{ font-size: 12px; color: var(--{P["muted"]}); min-width: 220px; }}
  td.viz {{ min-width: 90px; }}
  .bar {{ display: block; height: 10px; border-radius: 2px; background: var(--{P["accent"]}); }}
  .bar--thin {{ height: 6px; }}
  .box {{ display: inline-block; width: 44px; height: 44px; border: 1px solid var(--{P["accent"]}); background: color-mix(in srgb, var(--{P["accent"]}) 18%, transparent); }}
  .box--shadow {{ background: var(--{P["line"]}); border-color: transparent; border-radius: 6px; }}

  .cards {{ display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; }}
  .card {{ border: 1px solid var(--{P["line"]}); border-radius: 6px; background: var(--{P["surface"]}); overflow: hidden; min-width: 0; }}
  .card header {{ padding: 12px 14px 10px; display: flex; flex-direction: column; gap: 2px; }}
  .card header span {{ font-size: 12px; color: var(--{P["muted"]}); }}
  .card iframe {{ display: block; width: 100%; border: 0; border-top: 1px solid var(--{P["line"]}); border-bottom: 1px solid var(--{P["line"]}); background: var(--{P["bg"]}); }}
  .guide {{ padding: 10px 14px; font-size: 13px; color: var(--{P["muted"]}); }}
  .guide summary {{ cursor: pointer; font-weight: 600; color: var(--{P["ink"]}); }}
  .guide h4 {{ margin: 14px 0 4px; color: var(--{P["ink"]}); }}
  .guide p {{ margin: 8px 0; }}
  .guide ul {{ padding-left: 20px; margin: 8px 0; }}
  footer {{ margin-top: 72px; color: var(--{P["muted"]}); font-size: 12px; }}
</style>
</head>
<body>
<div class="wrap">
  <div class="topbar">
    <a href="../">← All experiments</a>
    {theme_seg}
  </div>

  <header class="hero">
    <p class="eyebrow">{esc(cfg["eyebrow"])}</p>
    <h1>{esc(cfg["title"])}</h1>
    <div class="lead"><p style="margin:0">{esc(cfg["tagline"])}</p></div>
    <div class="links">
      <a href="README.html">Read the guide</a>
      <a href="tokens.json">tokens.json</a>
      <a href="dist/tokens.css">tokens.css</a>
      <a href="components/bundle.css">bundle.css</a>
    </div>
  </header>
  {cover_html}

  <nav class="sections" aria-label="Sections">{nav}</nav>
  {body_sections}

  <footer>Exported from the Claude design system{alt_note}; page generated by <code>scripts/build-design-demo.py</code> from <code>tokens.json</code> and each component's <code>preview.html</code>.</footer>
</div>
<script>
(function () {{
  var root = document.documentElement;
  var frames = function () {{ return Array.prototype.slice.call(document.querySelectorAll('iframe')); }};
  function setTheme(t) {{
    root.setAttribute('data-theme', t);
    document.querySelectorAll('[data-theme-choice]').forEach(function (b) {{ b.setAttribute('aria-pressed', String(b.dataset.themeChoice === t)); }});
    frames().forEach(function (f) {{ try {{ f.contentDocument.documentElement.setAttribute('data-theme', t); }} catch (e) {{}} }});
    try {{ localStorage.setItem('{ROOT.name}-theme', t); }} catch (e) {{}}
  }}
  document.querySelectorAll('[data-theme-choice]').forEach(function (b) {{ b.addEventListener('click', function () {{ setTheme(b.dataset.themeChoice); }}); }});
  var saved = null; try {{ saved = localStorage.getItem('{ROOT.name}-theme'); }} catch (e) {{}}
  if (saved && document.querySelector('[data-theme-choice="' + saved + '"]')) setTheme(saved);

  // size each preview frame to its content
  function fit(f) {{
    try {{
      var d = f.contentDocument; if (!d || !d.body) return;
      f.style.height = '0px';
      var h = Math.ceil(d.documentElement.scrollHeight);
      f.style.height = (h > 20 ? h + 2 : 160) + 'px';
    }} catch (e) {{}}
  }}
  frames().forEach(function (f) {{
    if (f.closest('#cover')) return;
    f.addEventListener('load', function () {{
      try {{ f.contentDocument.documentElement.setAttribute('data-theme', root.getAttribute('data-theme')); }} catch (e) {{}}
      fit(f); setTimeout(function () {{ fit(f); }}, 150); setTimeout(function () {{ fit(f); }}, 800);
      try {{ new ResizeObserver(function () {{ fit(f); }}).observe(f.contentDocument.body); }} catch (e) {{}}
    }});
  }});

  // scale the 960px cover to the column width
  var cover = document.getElementById('cover');
  if (cover) {{
    var cf = cover.querySelector('iframe'), ch = parseFloat(cf.style.height);
    function scale() {{ var s = cover.clientWidth / 960; cf.style.transform = 'scale(' + s + ')'; cover.style.height = (ch * s) + 'px'; }}
    scale(); window.addEventListener('resize', scale);
    cf.addEventListener('load', function () {{ try {{ cf.contentDocument.documentElement.setAttribute('data-theme', root.getAttribute('data-theme')); }} catch (e) {{}} }});
  }}

  // color filter
  var filter = document.getElementById('filter');
  if (filter) filter.addEventListener('input', function () {{
    var q = filter.value.trim().toLowerCase();
    document.querySelectorAll('#swatches .sw').forEach(function (el) {{ el.hidden = q && el.textContent.toLowerCase().indexOf(q) < 0; }});
  }});
}})();
</script>
</body>
</html>
"""
(ROOT / "index.html").write_text(page)
print(f"wrote {ROOT.name}/dist/tokens.css and index.html ({len(cards)} component cards)")

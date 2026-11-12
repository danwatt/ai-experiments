#!/usr/bin/env python3
"""Build dist/ from tokens.json and src/components.css.

  python3 build.py

Writes:
  dist/bluebonnet-tokens.css  custom properties only (light, dark, prefers-color-scheme)
  dist/bluebonnet.css         tokens + classless base + bb- components, ready to link
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
tokens = json.loads((ROOT / "tokens.json").read_text())

ALIAS = re.compile(r"^\{([A-Za-z0-9_.-]+)\}$")


def css_value(v):
    m = ALIAS.match(v)
    return f"var(--{m.group(1)})" if m else v


def themed(family):
    """Return {theme_id: [(name, value)]} for a color- or shadow-shaped family."""
    themes = [t["id"] for t in tokens["color"]["themes"]]
    out = {t: [] for t in themes}
    for tok in family["tokens"]:
        val = tok["value"]
        if isinstance(val, str):
            val = {themes[0]: val}
        for i, t in enumerate(themes):
            if t in val:
                out[t].append((tok["name"], css_value(val[t])))
            elif i > 0 and ALIAS.match(val[themes[0]]):
                # aliases resolve per theme, so re-declare them in later themes
                out[t].append((tok["name"], css_value(val[themes[0]])))
    return out


colors = themed(tokens["color"])
shadows = themed(tokens.get("shadow", {"tokens": []}))
light_id, dark_id = [t["id"] for t in tokens["color"]["themes"]][:2]


def decls(pairs, indent="  "):
    return "\n".join(f"{indent}--{n}: {v};" for n, v in pairs)


lines = [
    f"/* {tokens['name']} tokens — generated from tokens.json by build.py. Do not edit by hand. */",
    "",
    f':root, [data-theme="{light_id}"] {{',
    decls(colors[light_id] + shadows[light_id]),
    "  color-scheme: light;",
    "}",
    "",
    "/* Follow the OS unless a page sets data-theme explicitly. */",
    "@media (prefers-color-scheme: dark) {",
    f'  :root:not([data-theme="{light_id}"]) {{',
    decls(colors[dark_id] + shadows[dark_id], "    "),
    "    color-scheme: dark;",
    "  }",
    "}",
    "",
    f'[data-theme="{dark_id}"] {{',
    decls(colors[dark_id] + shadows[dark_id]),
    "  color-scheme: dark;",
    "}",
    "",
    ":root {",
]
for fam in ("spacing", "radius"):
    lines.append(decls([(t["name"], t["value"]) for t in tokens[fam]["tokens"]]))
for key, stack in tokens["type"]["families"].items():
    lines.append(f"  --font-{key}: {stack};")
lines.append("}")
lines.append("")

# one utility class per type style
for group in tokens["type"]["groups"]:
    for st in group["styles"]:
        fam = st.get("family", group["family"])
        props = [
            f"font-family: var(--font-{fam})",
            f"font-size: {st['fontSize']}",
            f"line-height: {st['lineHeight']}",
            f"font-weight: {st['fontWeight']}",
        ]
        if "letterSpacing" in st:
            props.append(f"letter-spacing: {st['letterSpacing']}")
        if st["name"] == "text-label":
            props.append("text-transform: uppercase")
        lines.append(f".{st['name']} {{ " + "; ".join(props) + "; }")

tokens_css = "\n".join(lines) + "\n"
(ROOT / "dist").mkdir(exist_ok=True)
(ROOT / "dist" / "bluebonnet-tokens.css").write_text(tokens_css)

components = (ROOT / "src" / "components.css").read_text()
# @import must stay first in the combined file
imports = [l for l in components.splitlines() if l.startswith("@import")]
rest = "\n".join(l for l in components.splitlines() if not l.startswith("@import")).lstrip()
combined = "\n".join(imports) + "\n\n" + tokens_css + "\n" + rest
(ROOT / "dist" / "bluebonnet.css").write_text(combined)
print("wrote dist/bluebonnet-tokens.css and dist/bluebonnet.css")

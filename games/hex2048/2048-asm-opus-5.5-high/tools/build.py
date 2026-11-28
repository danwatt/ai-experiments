"""Assemble hex2048.asm and regenerate ../index.html from template.html.

Usage: python3 tools/build.py   (needs nasm on PATH)
"""
import base64, html, re, subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

subprocess.run(["nasm", "-f", "bin", str(ROOT / "hex2048.asm"), "-o", str(ROOT / "HEX2048.COM")], check=True)
src = (ROOT / "hex2048.asm").read_text()
com = (ROOT / "HEX2048.COM").read_bytes()

out = []
for line in src.split("\n"):
    code, sep, comment = line.partition(";")
    c = html.escape(code)
    c = re.sub(r"^([A-Za-z_.][\w.]*:)", r'<span class="l">\1</span>', c)
    if sep:
        c += '<span class="c">' + html.escape(";" + comment) + "</span>"
    out.append(c)

t = (HERE / "template.html").read_text()
t = (t.replace("__SOURCE__", "\n".join(out))
      .replace("__COM__", base64.b64encode(com).decode())
      .replace("__BYTES__", f"{len(com):,}")
      .replace("__LINES__", str(src.count("\n"))))
(ROOT / "index.html").write_text(t)
print(f"HEX2048.COM: {len(com)} bytes; index.html written")

"""Embed the validated source data into the portable page."""
import json, pathlib
root=pathlib.Path(__file__).resolve().parent
data=json.loads((root/'data.json').read_text())
template=(root/'template.html').read_text()
assert template.count('__DATA__')==1
(root/'index.html').write_text(template.replace('__DATA__',json.dumps(data,separators=(',',':')).replace('</','<\\/')))
print('Built self-contained index.html:',(root/'index.html').stat().st_size,'bytes')

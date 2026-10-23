"""GitHub-style diffs between bill versions, paragraph by paragraph with word highlights."""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from html import escape
from itertools import count

TOKEN = re.compile(r"\{\+|\+\}|\[-|-\]|\w+|\s+|[^\w\s]")
MARKERS = {"{+", "+}", "[-", "-]"}
_ids = count()


def _tokens(s: str) -> list[str]:
    return TOKEN.findall(s)


def _tok_html(tok: str) -> str:
    # The bill's own markup for changes to current law, shown dimmed like source.
    return f"<span class=mk>{escape(tok)}</span>" if tok in MARKERS else escape(tok)


def _span(cls: str, toks: list[str]) -> str:
    inner = "".join(_tok_html(t) for t in toks)
    return f"<span class={cls}>{inner}</span>" if inner.strip() else inner


def word_diff(old: str, new: str) -> tuple[str, str]:
    """HTML for an old/new paragraph pair with the changed words highlighted."""
    a, b = _tokens(old), _tokens(new)
    sm = SequenceMatcher(None, a, b, autojunk=False)
    left, right = [], []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            left.append("".join(_tok_html(t) for t in a[i1:i2]))
            right.append("".join(_tok_html(t) for t in b[j1:j2]))
        else:
            if i2 > i1:
                left.append(_span("wdel", a[i1:i2]))
            if j2 > j1:
                right.append(_span("wadd", b[j1:j2]))
    return "".join(left), "".join(right)


def _similar(x: str, y: str) -> float:
    sm = SequenceMatcher(None, x.split(), y.split(), autojunk=False)
    return sm.ratio() if sm.quick_ratio() > 0.4 else 0.0


def _pair(old: list[str], new: list[str]):
    """Inside a changed block, line up paragraphs that are edits of each other."""
    j = 0
    for i, o in enumerate(old):
        best, best_k = 0.0, None
        for k in range(j, min(len(new), j + 6)):
            r = _similar(o, new[k])
            if r > best:
                best, best_k = r, k
        if best_k is not None and best >= 0.45:
            for k in range(j, best_k):
                yield None, k
            yield i, best_k
            j = best_k + 1
        else:
            yield i, None
    for k in range(j, len(new)):
        yield None, k


def diff_rows(old: list[str], new: list[str], context: int = 2) -> tuple[list[tuple], int, int]:
    """Rows of (kind, old_no, new_no, html). kind: ctx / del / add / skip."""
    rows: list[tuple] = []
    added = removed = 0
    sm = SequenceMatcher(None, old, new, autojunk=False)
    ops = sm.get_opcodes()
    for n, (op, i1, i2, j1, j2) in enumerate(ops):
        if op == "equal":
            lines = list(range(i2 - i1))
            keep_head = context if n > 0 else 0
            keep_tail = context if n < len(ops) - 1 else 0
            if len(lines) <= keep_head + keep_tail + 1:
                shown, hidden = lines, []
            else:
                shown = lines[:keep_head] + lines[len(lines) - keep_tail :]
                hidden = lines[keep_head : len(lines) - keep_tail]
            hidden_set = set(hidden)
            for k in lines:
                if k in hidden_set:
                    if k == hidden[0]:
                        rows.append(("skip", len(hidden), None, [
                            (i1 + h + 1, j1 + h + 1, "".join(_tok_html(t) for t in _tokens(old[i1 + h])))
                            for h in hidden
                        ]))
                    continue
                rows.append(("ctx", i1 + k + 1, j1 + k + 1, "".join(_tok_html(t) for t in _tokens(old[i1 + k]))))
            continue
        for i, k in _pair(old[i1:i2], new[j1:j2]):
            if i is not None and k is not None:
                l, r = word_diff(old[i1 + i], new[j1 + k])
                rows.append(("del", i1 + i + 1, None, l))
                rows.append(("add", None, j1 + k + 1, r))
                added += 1
                removed += 1
            elif i is not None:
                rows.append(("del", i1 + i + 1, None, "".join(_tok_html(t) for t in _tokens(old[i1 + i]))))
                removed += 1
            else:
                rows.append(("add", None, j1 + k + 1, "".join(_tok_html(t) for t in _tokens(new[j1 + k]))))
                added += 1
    return rows, added, removed


def _blocks(added: int, removed: int) -> str:
    total = added + removed
    if not total:
        return ""
    g = round(5 * added / total)
    return "".join(f"<i class={'ba' if n < g else 'bd'}></i>" for n in range(5))


def render_diff(old_text: str, new_text: str, old_name: str, new_name: str, open_: bool = False) -> str:
    old = [p for p in old_text.splitlines() if p.strip()]
    new = [p for p in new_text.splitlines() if p.strip()]
    rows, added, removed = diff_rows(old, new)
    out = [
        f"<details class=diff{' open' if open_ else ''}><summary class=diffhead>"
        f"<span class=stat><span class=plus>+{added}</span> <span class=minus>−{removed}</span> {_blocks(added, removed)}</span>"
        f"<b>{escape(old_name)}</b> → <b>{escape(new_name)}</b>"
        f"<span class='muted small'> · paragraphs changed</span></summary><table class=difft>"
    ]
    if not rows or all(r[0] in ("ctx", "skip") for r in rows):
        out.append("<tr><td class=ctxnote colspan=4>No text changes.</td></tr>")
    for kind, a, b, body in rows:
        if kind == "skip":
            gid = f"d{next(_ids)}"
            out.append(
                f"<tr class=skip><td colspan=4><button type=button data-expand={gid}>"
                f"⋯ {a} unchanged paragraph{'s' if a != 1 else ''}</button></td></tr>"
            )
            for oa, ob, text in body:
                out.append(f"<tr class='ctx hid {gid}'><td class=ln>{oa}</td><td class=ln>{ob}</td><td class=sg></td><td class=tx>{text}</td></tr>")
            continue
        sign = {"del": "−", "add": "+", "ctx": ""}[kind]
        out.append(
            f"<tr class={kind}><td class=ln>{a or ''}</td><td class=ln>{b or ''}</td>"
            f"<td class=sg>{sign}</td><td class=tx>{body}</td></tr>"
        )
    out.append("</table></details>")
    return "".join(out)


def render_law_text(text: str) -> str:
    """Bill text with its own changes to current law shown as insertions and strikes."""
    out = []
    for para in text.splitlines():
        if not para.strip():
            continue
        h = escape(para)
        h = re.sub(r"\{\+(.*?)\+\}", r"<ins>\1</ins>", h)
        h = re.sub(r"\[-(.*?)-\]", r"<del>\1</del>", h)
        out.append(f"<p>{h}</p>")
    return "<div class=lawtext>" + "".join(out) + "</div>"


DIFF_CSS = """
:root{--dadd:#e6ffec;--daddw:#abf2bc;--ddel:#ffebe9;--ddelw:#ffcecb;--dhunk:#ddf4ff;--dln:#f6f8fa;--dfg:#1f2328;--dmk:#8c959f}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--dadd:rgba(46,160,67,.15);--daddw:rgba(46,160,67,.4);
--ddel:rgba(248,81,73,.15);--ddelw:rgba(248,81,73,.4);--dhunk:rgba(56,139,253,.15);--dln:#161b22;--dfg:#e6edf3;--dmk:#6e7681}}
:root[data-theme=dark]{--dadd:rgba(46,160,67,.15);--daddw:rgba(46,160,67,.4);--ddel:rgba(248,81,73,.15);--ddelw:rgba(248,81,73,.4);
--dhunk:rgba(56,139,253,.15);--dln:#161b22;--dfg:#e6edf3;--dmk:#6e7681}
details.diff{border:1px solid var(--line);border-radius:8px;margin:10px 0;background:var(--card);overflow:hidden}
summary.diffhead{padding:8px 12px;background:var(--dln);cursor:pointer;color:var(--dfg);font-size:14px;list-style-position:inside}
details.diff[open] summary.diffhead{border-bottom:1px solid var(--line)}
.stat{float:right;font:600 12px ui-monospace,Menlo,monospace}.plus{color:#1a7f37}.minus{color:#cf222e}
.stat i{display:inline-block;width:8px;height:8px;margin-left:1px;border-radius:1px}.stat .ba{background:#2da44e}.stat .bd{background:#cf222e}
table.difft{width:100%;border-collapse:collapse;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;table-layout:fixed}
.difft td{border:0;padding:1px 8px;vertical-align:top}
.difft td.ln{width:46px;text-align:right;color:var(--muted);background:var(--dln);user-select:none;font-size:11.5px}
.difft td.sg{width:18px;text-align:center;user-select:none;color:var(--muted)}
.difft td.tx{white-space:pre-wrap;word-wrap:break-word;color:var(--dfg)}
.difft tr.add td{background:var(--dadd)}.difft tr.add td.ln{background:var(--daddw)}
.difft tr.del td{background:var(--ddel)}.difft tr.del td.ln{background:var(--ddelw)}
.difft .wadd{background:var(--daddw);border-radius:2px}.difft .wdel{background:var(--ddelw);border-radius:2px}
.difft .mk{color:var(--dmk)}
.difft tr.skip td{background:var(--dhunk);padding:0}
.difft tr.skip button{all:unset;cursor:pointer;display:block;width:100%;padding:3px 12px;color:var(--muted);font-size:12px}
.difft tr.skip button:hover{color:var(--accent)}.difft tr.hid{display:none}.difft td.ctxnote{padding:10px 12px;color:var(--muted)}
.lawtext{font:13.5px/1.55 Georgia,serif;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:4px 14px;max-height:620px;overflow:auto}
.lawtext p{margin:6px 0}.mk{color:var(--dmk);font-family:ui-monospace,Menlo,monospace}ins{text-decoration:underline;text-decoration-color:#2da44e;text-decoration-thickness:2px;background:var(--dadd)}
del{color:var(--muted);text-decoration-color:#cf222e;background:var(--ddel)}
"""

DIFF_JS = """
document.addEventListener('click',function(e){
  var b=e.target.closest('[data-expand]'); if(!b) return;
  document.querySelectorAll('tr.'+b.dataset.expand).forEach(function(r){r.classList.remove('hid')});
  b.closest('tr').remove();
});
"""
